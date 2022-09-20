/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import IORedis from "ioredis";
import { EvictionScheme, RedisConstants, RedisExpiryModes } from "./constants";
import { CacheOptions } from "./types";

export default class RedisCache {
    private redis: IORedis.Redis;

    private namespace: string;

    // Score set is a ZSET that stores scores for each key
    private scoreSetKey: string;

    private evictionScheme: EvictionScheme;

    private ttl: number;

    private maxWidth: number;

    constructor(redis: IORedis.Redis, options: CacheOptions) {
        const { namespace, scheme, ttl, width } = options;

        this.redis = redis;

        this.namespace = `redis-cache:${namespace || 'default'}`;
        this.evictionScheme = scheme || EvictionScheme.LRU;
        this.ttl = ttl;

        if (width < 1) throw new Error('[RedisCache] Cache width needs to be >= 1');
        this.maxWidth = width;
    
        this.scoreSetKey = `${this.namespace}:scoreSet`;

        // If cache entries have a TTL remove expired entries from scoreSet every 1 minute
        if (this.ttl) setTimeout(this.clearExpiredEntries, 60000);
    }

    private transformIntoCacheKey = (key: string) => `${this.namespace}:cache:${key}`; 

    private redisTransaction = () => this.redis.multi();

    private getScore = (key: string) => {
        switch (this.evictionScheme) {
            case EvictionScheme.LRU: {
                return -1 * (new Date().getTime());
            }
            default: {
                throw new Error(`[RedisCache] Cache scheme ${this.evictionScheme} not supported`);
            }
        }
    };

    private clearExpiredEntries = async () => {
        if (!this.ttl) return;

        const largestValidScore = -1 * ((new Date().getTime()) - this.ttl);
        return this.redis.zremrangebyscore(this.scoreSetKey, largestValidScore, RedisConstants.Max)
            .catch((err) => { throw new Error(`[RedisCache] Could not clear expired cache entries - ${err}`) });
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
            .get(key)
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
        return JSON.parse(value);
    }

    /**
     * Upserts a value in the cache at the specified key
     * @param key Cache key at which the value has to be stored
     * @param value The value to be stored at the key
     */
    public set = async (key: string, value: any) => {
        const cacheKey = this.transformIntoCacheKey(key);
        const score = this.getScore(cacheKey);

        const expiryMode = this.ttl ? RedisExpiryModes.Milliseconds : undefined;
        const result = await this.redisTransaction()
            // set value in cache
            .set(key, JSON.stringify(value), expiryMode, this.ttl)
            // add its score to scoreSet
            .zadd(this.scoreSetKey, score, cacheKey)
            // get all values overflowing the cache width
            .zrange(this.scoreSetKey, this.maxWidth, -1)
            .exec();

        result.forEach(([err, _]) => {
            if (err) throw err;
        });

        // If cache width is reached, evict extra values from cache
        const deletionCandidateKeys: string[] = result[2][1];
        if (deletionCandidateKeys.length > 0) {
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

    // ----------- Decorator Methods -----------

    /**
     * Decorator to read a value from cache if it exists, and set the value on cache if it doesn't
     * @param keys Ordered list of identifiers for value in cache
     */
    public async getOrSet(...keys: string[]) {
        const cacheInstance = this;
        return function (target: Function, propertyKey: string, descriptor: TypedPropertyDescriptor<(... params: any[])=> Promise<any>>) {
            let originalFn = descriptor.value;
            descriptor.value = async function () {
                const cacheKey = keys.join(':');
                const cachedResult = await cacheInstance.get(cacheKey);
                if (cachedResult) return cachedResult;

                const result = await originalFn.apply(this, arguments);
                cacheInstance.set(cacheKey, result)
                    .catch((err) => { throw new Error(`[RedisCache] Unable to set value to cache - ${err}`) });

                return result;
            }
        }
    }

    /**
     * Decorator to remove value from cache
     * @param keys Ordered list of identifiers in cache
     */
    public async invalidate(...keys: string[]) {
        const cacheInstance = this;
        return function (target: Function, propertyKey: string, descriptor: TypedPropertyDescriptor<(... params: any[])=> Promise<any>>) {
            let originalFn = descriptor.value;
            descriptor.value = async function () {
                const cacheKey = keys.join(':');
                const result = await originalFn.apply(this, arguments);
                cacheInstance.del(cacheKey)
                    .catch((err) => { throw new Error(`[RedisCache] Unable to delete value from cache - ${err}`)});

                return result;
            }
        }
    }
}