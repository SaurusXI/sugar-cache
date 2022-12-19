/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import { Redis } from "ioredis";
import readFunctionParams from '@captemulation/get-parameter-names';
import { dummyLogger, Logger } from 'ts-log';
import { EvictionScheme, RedisConstants, RedisExpiryModes, RedisZaddOptions } from "./constants";
import { CacheOptions } from "./types";

export class SugarCache {
    private redis: Redis;

    private namespace: string;

    // Score set is a ZSET that stores scores for each key
    private scoreSetKey: string;

    private evictionScheme: EvictionScheme;

    private ttl: number;

    private maxWidth: number;

    private readonly logger: Logger;

    constructor(redis: Redis, options: CacheOptions, logger: Logger = dummyLogger) {
        const { namespace, scheme, ttl, width } = options;

        this.redis = redis;

        this.namespace = `{sugar-cache:${namespace || 'default'}}`;
        this.evictionScheme = scheme || EvictionScheme.LRU;
        this.ttl = ttl;

        this.logger = logger;

        if (width < 1) throw new Error('[SugarCache] Cache width needs to be >= 1');
        this.maxWidth = width;
    
        this.scoreSetKey = `${this.namespace}:scoreSet`;

        // If cache entries have a TTL remove expired entries from scoreSet every 1 minute
        if (this.ttl) {
            setInterval(this.clearExpiredEntries, 60000);
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
                throw new Error(`[SugarCache:${this.namespace}] Cache scheme ${this.evictionScheme} not supported`);
            }
        }
    };

    private clearExpiredEntries = async () => {
        if (!this.ttl) return;

        this.logger.debug(`[SugarCache:${this.namespace}] Clearing expired entries for cache ${this.namespace}`);

        const largestValidScore = -1 * ((new Date().getTime()) - this.ttl);
        await this.redis.zremrangebyscore(this.scoreSetKey, largestValidScore, RedisConstants.Max)
            .catch((err) => { throw new Error(`[SugarCache]:${this.namespace} Could not clear expired cache entries - ${err}`) });
    }

    private validateKeys = (targetFn: any, cacheKeys: string[]) => {
        const params = readFunctionParams(targetFn);
        const invalidKeys = cacheKeys.filter(k => !params.includes(k));

        if (invalidKeys.length) {
            this.logger.debug(`[SugarCache:${this.namespace}] Function params - ${JSON.stringify(params)}, cacheKeys - ${JSON.stringify(cacheKeys)}, invalid keys - ${JSON.stringify(invalidKeys)}`)
            throw new Error('[SugarCache] Keys passed to decorator do not match function params');
        }
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
            .zadd(this.scoreSetKey, RedisZaddOptions.UpdateOnly, score, cacheKey)
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });

        // If value is expired and still in scoreSet, remove from scoreSet
        if (result[0][1] === null && result[1][1]) {
            this.logger.debug(`[SugarCache:${this.namespace}] Value for ${key} is expired but is still stored in scoreSet - ${JSON.stringify(result[1][1])}, removing`);
            await this.redis.zrem(this.scoreSetKey, cacheKey);
            return null;
        }
        
        const [_, value] = result[0];

        let output;
        try {
            output = JSON.parse(value as string);
        } catch (err) {
            if (err instanceof SyntaxError) {
                output = null;
            }
            this.logger.debug(`[SugarCache:${this.namespace}] Error encountered in parsing - ${err}`);
            throw err;
        }
        return output;
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
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });

        // If cache width is reached, evict extra values from cache
        const deletionCandidateKeys = result[2][1] as string[];
        if (deletionCandidateKeys.length > 0) {
            this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidates - ${JSON.stringify(deletionCandidateKeys)}`);
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
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });
    }

    /**
     * Deletes all values in the cache
     * Bear in mind that this will only remove values from redis that are under the namespace of the cache object
     */
    public clear = async () => {
        const deletionCandidateKeys = await this.redis.zrange(this.scoreSetKey, 0, -1);
        
        this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidate keys - ${deletionCandidateKeys}`);
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
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            let originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            cacheInstance.validateKeys(originalFn, keys);

            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);
                const cacheKeyArgs = keys.map(k => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] Checking key ${cacheKey} in cache`);
                const cachedResult = await cacheInstance.get(cacheKey);
                if (cachedResult !== null) {
                    cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] result for key ${cacheKey} found in cache. Returning...`);
                    return cachedResult
                };

                const result = await currentFn.apply(this, arguments);
                await cacheInstance.set(cacheKey, result)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to set value to cache - ${err}`) });

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] result for key ${cacheKey} set in cache`)

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
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            let originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            cacheInstance.validateKeys(originalFn, keys);

            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);

                const cacheKeyArgs = keys.map(k => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                await cacheInstance.del(cacheKey)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to delete value from cache - ${err}`)});

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] removed key ${cacheKey} from cache`)
                const result = await currentFn.apply(this, arguments);

                return result;
            }
            descriptor.value.originalFn = originalFn;
        }
    }
}