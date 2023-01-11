/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import { Cluster, Redis } from "ioredis";
import readFunctionParams from '@captemulation/get-parameter-names';
import { dummyLogger, Logger } from 'ts-log';
import { RedisConstants, RedisExpiryModes } from "./constants";
import { CacheResultParams, CreateCacheOptions, InvalidateFromCacheParams, TTL } from "./types";

export class SugarCache {
    private redis: Redis | Cluster;

    private namespace: string;

    private readonly logger: Logger;

    constructor(redis: Redis | Cluster, options: CreateCacheOptions, logger: Logger = dummyLogger) {
        const { namespace } = options;
        this.redis = redis;
        this.namespace = `sugar-cache:${namespace || 'default'}`;
        this.logger = logger;
    }

    private transformIntoCacheKey = (key: string) => `${this.namespace}:${key}`; 

    private redisTransaction = () => this.redis.multi();

    private computeTTLInMilliseconds = (ttl: TTL) => {
        if (typeof ttl === 'number') {
            return ttl;
        } else {
            const { value, unit } = ttl;
            switch (unit) {
                case 'milliseconds': {
                    return value;
                }
                case 'seconds': {
                    return value * 1000;
                }
                case 'minutes': {
                    return value * 1000 * 60;
                }
                case 'hours': {
                    return value * 1000 * 60 * 60;
                }
                case 'days': {
                    return value * 1000 * 60 * 60 * 24;
                }
                default: {
                    throw new Error(`[SugarCache]:${this.namespace} Incorrect TTL unit provided to constructor`);
                }
            }
        }
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

        const result = await this.redisTransaction()
            // fetch value
            .get(cacheKey)
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });
        
        const [_, value] = result[0];

        let output;
        try {
            output = JSON.parse(value as string);
        } catch (err) {
            this.logger.debug(`[SugarCache:${this.namespace}] Error encountered in parsing - ${err}`);
            output = null;
        }
        return output;
    }

    /**
     * Upserts a value in the cache at the specified key
     * @param key Cache key at which the value has to be stored
     * @param value The value to be stored at the key
     */
    public set = async (key: string, value: any, ttl: TTL) => {
        const cacheKey = this.transformIntoCacheKey(key);

        const result = await this.redisTransaction()
            // set value in cache
            .set(cacheKey, JSON.stringify(value), RedisExpiryModes.Milliseconds, this.computeTTLInMilliseconds(ttl))
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });
    }

    /**
     * Deletes a value from the cache
     * @param key Key of value to be removed
     */
    public del = async (key: string) => {
        const cacheKey = this.transformIntoCacheKey(key);
        
        const result = await this.redisTransaction()
            .del(cacheKey)
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
     * This is an expensive operation (since it operates on all keys inside a namespace) and should be used with care
     */
    public clear = async () => {
        if (this.redis instanceof Cluster) {
            const deletionCandidateKeysMap = await Promise.all((this.redis as Cluster).nodes('master')
                .map(async (node) => {
                    return node.keys(`${this.namespace}*`);
                    
                }));
            const deletionCandidateKeys = [].concat(...deletionCandidateKeysMap);
            this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidate keys - ${deletionCandidateKeys}`);
            await Promise.all(deletionCandidateKeys.map(k => this.redis.del(k)));
            this.logger.debug(`[SugarCache:${this.namespace}] Deletion keys removed`);
            return;
        }
        const deletionCandidateKeys = await this.redis.keys(`${this.namespace}*`);
        
        this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidate keys - ${deletionCandidateKeys}`);
        if (!deletionCandidateKeys.length) return;

        await this.redis.del(deletionCandidateKeys);

        this.logger.debug(`[SugarCache:${this.namespace}] Deletion keys removed`);
    }

    // ----------- Decorator Methods -----------

    /**
     * Decorator to read a value from cache if it exists
     * If it doesn't the target function is called and the return value is set on cache
     * @param keys Ordered list of identifiers for value in cache
     */
    public cacheFnResult(params: CacheResultParams) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            let originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { keyVariables: keys, ttl } = params;

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
                await cacheInstance.set(cacheKey, result, ttl)
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
    public invalidateFromCache(params: InvalidateFromCacheParams) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            let originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { keyVariables: keys } = params;

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