/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import Redis from "ioredis";
import { EvictionScheme, RedisConstants, RedisExpiryModes } from "./constants";
import { CacheOptions } from "./types";
import readFunctionParams from '@captemulation/get-parameter-names';

export default class SugarCache {
    private redis: Redis;

    private namespace: string;

    // Score set is a ZSET that stores scores for each key
    private scoreSetKey: string;

    private evictionScheme: EvictionScheme;

    private ttl: number;

    private maxWidth: number;

    constructor(redis: Redis, options: CacheOptions) {
        const { namespace, scheme, ttl, width } = options;

        this.redis = redis;

        this.namespace = `sugar-cache:${namespace || 'default'}`;
        this.evictionScheme = scheme || EvictionScheme.LRU;
        this.ttl = ttl;

        if (width < 1) throw new Error('[SugarCache] Cache width needs to be >= 1');
        this.maxWidth = width;
    
        this.scoreSetKey = `${this.namespace}:scoreSet`;

        // If cache entries have a TTL remove expired entries from scoreSet every 1 minute
        if (this.ttl) {
            setTimeout(this.clearExpiredEntries, 60000);
        }
    }

    private transformIntoCacheKey = (key: string) => `${this.namespace}:cache:${key}`; 

    private redisTransaction = () => this.redis.multi();

    private getScore = (key: string) => {
        switch (this.evictionScheme) {
            case EvictionScheme.LRU: {
                return -1 * (new Date().getTime());
            }
            default: {
                throw new Error(`[SugarCache] Cache scheme ${this.evictionScheme} not supported`);
            }
        }
    };

    private clearExpiredEntries = async () => {
        if (!this.ttl) return;

        const largestValidScore = -1 * ((new Date().getTime()) - this.ttl);
        await this.redis.zremrangebyscore(this.scoreSetKey, largestValidScore, RedisConstants.Max)
            .catch((err) => { throw new Error(`[SugarCache] Could not clear expired cache entries - ${err}`) });
    }

    private static validateKeys = (targetFn: any, cacheKeys: string[]) => {
        const params = readFunctionParams(targetFn);
        const invalidKeys = cacheKeys.filter(k => !params.includes(k));
        if (invalidKeys.length) throw new Error('[SugarCache] Keys passed to decorator do not match function params');
    }

    private static transformIntoNamedArgs = (args: IArguments, targetFn: any) => {
        const params = readFunctionParams(targetFn);
        let namedArguments = {};
        Array.from(args).forEach((arg, idx) => {
            namedArguments[params[idx]] = arg;
        });
        return namedArguments;
    } 

    // ----------- Public API Methods -----------

    /**
     * Reads an element stored at a key
     * @param key Cache key for the element you're trying to fetch
     * @returns The object stored at the given key; `null` if no such object is found
     */
    public get = async (key: string) => {
        const cacheKey = this.transformIntoCacheKey(key);
        const score = this.getScore(cacheKey);

        const result = await this.redisTransaction()
            // fetch value
            .get(cacheKey)
            // update its score in the score set
            .zadd(this.scoreSetKey, score, cacheKey)
            .exec();

        result.forEach(([err, _]) => {
            if (err) throw err;
        });

        // If value is expired and still in scoreSet, remove from scoreSet
        if (result[0][1] === null && result[1][1]) {
            await this.redis.zrem(this.scoreSetKey, cacheKey);
            return null;
        }
        
        const [_, value] = result[0];
        return JSON.parse(value as string);
    }

    /**
     * Upserts a value in the cache at the specified key
     * @param key Cache key at which the value has to be stored
     * @param value The value to be stored at the key
     */
    public set = async (key: string, value: any) => {
        const cacheKey = this.transformIntoCacheKey(key);
        const score = this.getScore(cacheKey);

        const setQueryParams = this.ttl ? [cacheKey, JSON.stringify(value), RedisExpiryModes.Milliseconds, this.ttl] : [cacheKey, JSON.stringify(value)];
        const result = await this.redisTransaction()
            // set value in cache
            // @ts-ignore
            .set(...setQueryParams)
            // add its score to scoreSet
            .zadd(this.scoreSetKey, score, cacheKey)
            // get all values overflowing the cache width
            .zrange(this.scoreSetKey, this.maxWidth, -1)
            .exec();

        result.forEach(([err, _]) => {
            if (err) throw err;
        });

        // If cache width is reached, evict extra values from cache
        const deletionCandidateKeys = result[2][1] as string[];
        if (deletionCandidateKeys.length > 0) {
            console.log(`Deletion candidates - ${JSON.stringify(deletionCandidateKeys)}`);
            await this.redisTransaction()
                .zrem(this.scoreSetKey, ...deletionCandidateKeys)
                .del(...deletionCandidateKeys)
                .exec();
        }
    }

    /**
     * Deletes a value from the cache
     * @param key Key of value to be removed
     */
    public del = async (key: string) => {
        const cacheKey = this.transformIntoCacheKey(key);
        
        const result = await this.redisTransaction()
            .del(cacheKey)
            .zrem(this.scoreSetKey, cacheKey)
            .exec();
        
        result.forEach(([err, _]) => {
            if (err) throw err;
        });
    }

    /**
     * Deletes all values in the cache
     * Bear in mind that this will only remove values from redis that are under the namespace of the cache object
     */
    public clear = async () => {
        const deletionCandidateKeys = await this.redis.zrange(this.scoreSetKey, 0, -1);
        if (!deletionCandidateKeys.length) return;
        await this.redisTransaction()
            .zremrangebyscore(this.scoreSetKey, RedisConstants.Min, RedisConstants.Max)
            .del(...deletionCandidateKeys)
            .exec();
    }

    // ----------- Decorator Methods -----------

    /**
     * Decorator to read a value from cache if it exists
     * If it doesn't the target function is called and the return value is set on cache
     * @param keys Ordered list of identifiers for value in cache
     */
    public getOrSet(keys: string[]) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
            let originalFn = descriptor.value.originalFn || descriptor.value;

            SugarCache.validateKeys(originalFn, keys);

            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);
                const cacheKeyArgs = keys.map(k => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                const cachedResult = await cacheInstance.get(cacheKey);
                if (cachedResult !== null) return cachedResult;

                const result = await originalFn.apply(this, arguments);
                cacheInstance.set(cacheKey, result)
                    .catch((err) => { throw new Error(`[SugarCache] Unable to set value to cache - ${err}`) });

                return result;
            };
            descriptor.value.originalFn = originalFn;
        }
    }

    /**
     * Decorator to remove value from cache
     * @param keys Ordered list of identifiers in cache
     */
    public invalidate(keys: string[]) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
            let originalFn = descriptor.value.originalFn || descriptor.value;

            SugarCache.validateKeys(originalFn, keys);

            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);

                const cacheKeyArgs = keys.map(k => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                const result = await originalFn.apply(this, arguments);
                cacheInstance.del(cacheKey)
                    .catch((err) => { throw new Error(`[SugarCache] Unable to delete value from cache - ${err}`)});

                return result;
            }
            descriptor.value.originalFn = originalFn;
        }
    }
}