/* eslint-disable no-param-reassign */
/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import { Cluster, Redis } from 'ioredis';
import readFunctionParams from '@captemulation/get-parameter-names';
import MultilevelCache from './cache';
import { dummyLogger, Logger } from './types/logging';
import {
    CacheFnResultParams,
    CreateCacheOptions,
    InvalidateFromCacheParams,
    KeyVariables,
    TTL,
    TTLOptions,
} from './types';

type KeysObject<KeyName extends string> = {
    [_Property in KeyName]: string
};

export default class SugarCache<
    KeyName extends string,
    Keys extends KeysObject<KeyName> = KeysObject<KeyName>,
> {
    private namespace: string;

    private cache: MultilevelCache;

    private readonly logger: Logger;

    private hashtags: Set<KeyName>;

    constructor(
        redis: Redis | Cluster,
        options: CreateCacheOptions<KeyName>,
        logger: Logger = dummyLogger,
    ) {
        this.logger = logger;
        this.cache = new MultilevelCache(options, redis, logger);
        this.namespace = this.cache.namespace;

        const { hashtags } = options;

        this.hashtags = new Set();
        if (hashtags) {
            this.hashtags = new Set(
                Object.keys(hashtags).filter((key) => hashtags[key]),
            ) as Set<KeyName>;
        }
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
            namedArguments[params[idx]] = arg as string;
        });
        return namedArguments;
    };

    // eslint-disable-next-line class-methods-use-this
    private flattenKeysIntoKeyList = (keys: Keys) => Object
        .entries(keys)
        // Sort so we always get keys in the same order
        .sort((keyA, keyB) => keyA[0].localeCompare(keyB[0]))
        .map(([_, val]) => val as string);

    private wrapValuesInHashtags = (keys: Keys) => {
        // NOTE: copy keys to not mutate callers original object
        const out = {} as Keys;
        Object.keys(keys).forEach((key: KeyName) => {
            if (this.hashtags.has(key)) {
                out[key] = `{${keys[key]}}` as any;
            } else {
                out[key] = keys[key];
            }
        });
        return out;
    };

    private transformKeysIntoKeyList = (keys: Keys) => this.flattenKeysIntoKeyList(
        this.wrapValuesInHashtags(keys),
    );

    // ----------- Public API Methods -----------

    /**
     * Reads an element stored at a key
     * @param keys Cache keys for the element you're trying to fetch
     * @returns The object stored at the given key; `null` if no such object is found
     */
    public get = async (
        keys: Keys,
    ) => this.cache.get(this.transformKeysIntoKeyList(keys));

    /**
     * Upserts a value in the cache at the specified key
     * @param keys Cache keys at which the value has to be stored
     * @param value The value to be stored at the key
     * @param ttl TTL of values set in cache.
     * You can specify different TTLs for in-memory and redis caches
     */
    public set = async (
        keys: Keys,
        value: any,
        ttl: TTL | TTLOptions,
    ) => {
        const flattenedKeyList = this.transformKeysIntoKeyList(keys);
        if ((ttl as TTLOptions).redis) {
            const ttlOptions = ttl as TTLOptions;
            return this.cache.set(flattenedKeyList, value, ttlOptions);
        }
        const ttlTyped = ttl as TTL;
        return this.cache.set(flattenedKeyList, value, { memory: ttlTyped, redis: ttlTyped });
    };

    /**
     * Deletes a value from the cache
     * @param keys Key of value to be removed
     */
    public del = async (
        keys: Keys,
    ) => this.cache.del(this.transformKeysIntoKeyList(keys));

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

    /**
     * Performs an efficient batched read operation on the keys provided.
     * @param keys List of keys to fetch results for
     * @returns Values set at the given keys. Returns `null` for each key that isn't set
     */
    public mget = async (keys: Keys[]) => this.cache.mget(keys.map(this.transformKeysIntoKeyList));

    /**
     * Performs an efficient batched delete operation on the keys provided.
     * @param keys List of keys to perform delete for.
     */
    public mdel = async (keys: Keys[]) => this.cache.mdel(keys.map(this.transformKeysIntoKeyList));

    /**
     * Performs an efficient batched set operation for the key-value pairs provided
     * @param keys List of keys
     * @param values Ordered list of values.
     * Every value is expected to positionally map to an element in `keys`
     * @param ttl Time-to-live for values in cache
     */
    public mset = async (
        keys: Keys[],
        values: any[],
        ttl: TTL | TTLOptions,
    ) => {
        const flattenedKeyLists = keys.map(this.transformKeysIntoKeyList);
        if ((ttl as TTLOptions).redis) {
            const ttlOptions = ttl as TTLOptions;
            return this.cache.mset(flattenedKeyLists, values, ttlOptions);
        }
        const ttlTyped = ttl as TTL;
        return this.cache.mset(flattenedKeyLists, values, {
            redis: ttlTyped,
            memory: ttlTyped,
        });
    };

    // ----------- Decorator Methods -----------

    // eslint-disable-next-line class-methods-use-this
    private reduceKeyVariablesToKeys(keyVariables: KeyVariables<Keys>, namedArgs: any) {
        const out = {} as Keys;

        if (Object.keys(keyVariables).length !== Object.keys(namedArgs).length) {
            throw new Error('Invalid arguments passed to function');
        }

        Object.keys(keyVariables).forEach((keyName) => {
            const variableName = keyVariables[keyName] as string;
            const variableValue = namedArgs[variableName];
            if (variableValue === undefined) {
                throw new Error('Invalid arguments passed to function');
            }

            out[keyName] = variableName;
        });

        return out;
    }

    private getKeysFromFunc(args: IArguments, originalFn: any, keyVariables: KeyVariables<Keys>) {
        const namedArguments = SugarCache.transformIntoNamedArgs(args, originalFn);
        return this.reduceKeyVariablesToKeys(
            keyVariables,
            namedArguments,
        );
    }

    /**
     * Decorator to read a value from cache if it exists
     * If it doesn't the target function is called and the return value is set on cache
     */
    public cacheFnResult(
        params: CacheFnResultParams<Keys>,
    ) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            const originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { variableNames: keyVariables, ttl } = params;

            cacheInstance.validateKeys(originalFn, Object.values(keyVariables));

            // eslint-disable-next-line no-param-reassign
            descriptor.value = async function () {
                const keys = cacheInstance.getKeysFromFunc(arguments, originalFn, keyVariables);

                const cachedResult = await cacheInstance.get(keys);
                if (cachedResult !== null) {
                    return cachedResult;
                }

                const result = await currentFn.apply(this, arguments);
                await cacheInstance.set(keys, result, ttl)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to set value to cache - ${err}`); });

                return result;
            };
            descriptor.value.originalFn = originalFn;
        };
    }

    /**
     * Decorator to remove value from cache
     */
    public invalidateFromCache(
        params: InvalidateFromCacheParams<Keys>,
    ) {
        const cacheInstance = this;
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): any {
            const originalFn = descriptor.value.originalFn || descriptor.value;
            const currentFn = descriptor.value;

            const { variableNames: keyVariables } = params;

            cacheInstance.validateKeys(originalFn, Object.values(keyVariables));

            descriptor.value = async function () {
                const keys = cacheInstance.getKeysFromFunc(arguments, originalFn, keyVariables);

                await cacheInstance.del(keys)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to delete value from cache - ${err}`); });

                const result = await currentFn.apply(this, arguments);

                return result;
            };
            descriptor.value.originalFn = originalFn;
        };
    }
}
