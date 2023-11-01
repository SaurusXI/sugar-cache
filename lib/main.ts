/* eslint-disable no-param-reassign */
/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import { Cluster, Redis } from 'ioredis';
import readFunctionParams from '@captemulation/get-parameter-names';
import MultilevelCache from './cache';
import { dummyLogger, Logger } from './types/logging';
import {
    CacheFnResultParams, CreateCacheOptions, InvalidateFromCacheParams, TTL, TTLOptions,
} from './types';

export default class SugarCache {
    private namespace: string;

    private cache: MultilevelCache;

    private readonly logger: Logger;

    constructor(redis: Redis | Cluster, options: CreateCacheOptions, logger: Logger = dummyLogger) {
        this.logger = logger;
        this.cache = new MultilevelCache(options, redis, logger);
        this.namespace = this.cache.namespace;
    }

    private validateKeys = (targetFn: any, cacheKeys: string[]) => {
        const params = readFunctionParams(targetFn);
        const invalidKeys = cacheKeys.filter((k) => !params.includes(k));

        if (invalidKeys.length) {
            this.logger.debug(`[SugarCache:${this.namespace}] Function params - ${JSON.stringify(params)}, cacheKeys - ${JSON.stringify(cacheKeys)}, invalid keys - ${JSON.stringify(invalidKeys)}`);
            throw new Error('[SugarCache] Keys passed to decorator do not match function params');
        }
    };

    private static transformIntoNamedArgs = (args: IArguments, targetFn: any) => {
        const params = readFunctionParams(targetFn);
        const namedArguments = {};
        Array.from(args).forEach((arg, idx) => {
            namedArguments[params[idx]] = arg;
        });
        return namedArguments;
    };

    // ----------- Public API Methods -----------

    /**
     * Reads an element stored at a key
     * @param keys Cache keys for the element you're trying to fetch
     * @returns The object stored at the given key; `null` if no such object is found
     */
    public get = async (keys: string[]) => this.cache.get(keys);

    /**
     * Upserts a value in the cache at the specified key
     * @param keys Cache keys at which the value has to be stored
     * @param value The value to be stored at the key
     * @param ttl TTL of values set in cache.
     * You can specify different TTLs for in-memory and redis caches
     */
    public set = async (
        keys: string[],
        value: any,
        ttl: TTL | TTLOptions,
    ) => {
        if ((ttl as TTLOptions).redis) {
            const ttlOptions = ttl as TTLOptions;
            return this.cache.set(keys, value, ttlOptions);
        }
        const ttlTyped = ttl as TTL;
        return this.cache.set(keys, value, { memory: ttlTyped, redis: ttlTyped });
    };

    /**
     * Deletes a value from the cache
     * @param keys Key of value to be removed
     */
    public del = async (keys: string[]) => this.cache.del(keys);

    /**
     * Deletes all values in the cache
     * Bear in mind that this will only remove values from redis that are
     * under the namespace of the cache object
     * This is an expensive operation (since it operates on all keys inside a namespace)
     * and should be used with care
     */
    public clear = async () => {
        await this.cache.clear();
    };

    public batchGet = async (keys: string[][]) => this.cache.batchGet(keys);

    public batchDel = async (keys: string[][]) => this.cache.batchDel(keys);

    public batchSet = async (keys: string[][], values: any[], ttl: TTL | TTLOptions) => {
        if ((ttl as TTLOptions).redis) {
            const ttlOptions = ttl as TTLOptions;
            return this.cache.batchSet(keys, values, ttlOptions);
        }
        const ttlTyped = ttl as TTL;
        return this.cache.batchSet(keys, values, { redis: ttlTyped, memory: ttlTyped });
    };

    // ----------- Decorator Methods -----------

    /**
     * Decorator to read a value from cache if it exists
     * If it doesn't the target function is called and the return value is set on cache
     */
    public cacheFnResult(params: CacheFnResultParams) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            const originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { keyVariables: keys, ttl } = params;

            cacheInstance.validateKeys(originalFn, keys);

            // eslint-disable-next-line no-param-reassign
            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);
                const cacheKeyArgs = keys.map((k) => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] Checking key ${cacheKey} in cache`);
                const cachedResult = await cacheInstance.get([cacheKey]);
                if (cachedResult !== null) {
                    cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] result for key ${cacheKey} found in cache. Returning...`);
                    return cachedResult;
                }

                const result = await currentFn.apply(this, arguments);
                await cacheInstance.set([cacheKey], result, ttl)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to set value to cache - ${err}`); });

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] result for key ${cacheKey} set in cache`);

                return result;
            };
            descriptor.value.originalFn = originalFn;
        };
    }

    /**
     * Decorator to remove value from cache
     */
    public invalidateFromCache(params: InvalidateFromCacheParams) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            const originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { keyVariables: keys } = params;

            cacheInstance.validateKeys(originalFn, keys);

            descriptor.value = async function () {
                const namedArguments = SugarCache.transformIntoNamedArgs(arguments, originalFn);

                const cacheKeyArgs = keys.map((k) => namedArguments[k]);
                const cacheKey = cacheKeyArgs.join(':');

                await cacheInstance.del([cacheKey])
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to delete value from cache - ${err}`); });

                cacheInstance.logger.debug(`[SugarCache:${cacheInstance.namespace}] removed key ${cacheKey} from cache`);
                const result = await currentFn.apply(this, arguments);

                return result;
            };
            descriptor.value.originalFn = originalFn;
        };
    }
}
