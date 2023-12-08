/* eslint-disable no-param-reassign */
/**
 * @author Shantanu Verma (github.com/SaurusXI)
 */

import { Cluster, Redis } from 'ioredis';
import readFunctionParams from '@captemulation/get-parameter-names';
import MultilevelCache from './cache';
import { dummyLogger, Logger } from './types/logging';
import {
    MemoizeParams,
    CreateCacheOptions,
    TTL,
    CachewiseTTL,
    KeysObject,
    UpdateMemoizedParams,
} from './types';
import { DecoratedMethod } from './types/internals';

export default class SugarCache<
    const KeyNames extends readonly string[],
    KeyName extends string = KeyNames[number],
    Keys extends KeysObject<KeyName> = KeysObject<KeyName>,
> {
    private namespace: string;

    private cache: MultilevelCache;

    private hashtags: Set<KeyName>;

    private keyNames: KeyNames;

    constructor(
        redis: Redis | Cluster,
        options: CreateCacheOptions<KeyNames>,
        readonly logger: Logger = dummyLogger,
    ) {
        this.keyNames = options.keys;
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

    private validateKeys = (targetFn: any, fnName: string) => {
        const params = readFunctionParams(targetFn);
        const missingKeys = this.keyNames.filter((k) => !(params.includes(k)));

        if (missingKeys.length) {
            this.logger.debug(`[SugarCache:${this.namespace}] Function params - ${JSON.stringify(params)}, cacheKeys - ${JSON.stringify(this.keyNames)}, missing keys - ${JSON.stringify(missingKeys)}`);
            throw new Error(`[SugarCache:${this.namespace}] Keys passed to decorator for function "${fnName}" do not match function params. Args passed- ${JSON.stringify(params)}. Required keys not found- ${JSON.stringify(missingKeys)}`);
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
        ttl: TTL | CachewiseTTL,
    ) => {
        const flattenedKeyList = this.transformKeysIntoKeyList(keys);
        if ((ttl as CachewiseTTL).redis) {
            const ttlOptions = ttl as CachewiseTTL;
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
        ttl: TTL | CachewiseTTL,
    ) => {
        const flattenedKeyLists = keys.map(this.transformKeysIntoKeyList);
        if ((ttl as CachewiseTTL).redis) {
            const ttlOptions = ttl as CachewiseTTL;
            return this.cache.mset(flattenedKeyLists, values, ttlOptions);
        }
        const ttlTyped = ttl as TTL;
        return this.cache.mset(flattenedKeyLists, values, {
            redis: ttlTyped,
            memory: ttlTyped,
        });
    };

    // ----------- Decorator Methods -----------

    private extractKeysFromFunc(namedArgs: any) {
        const out = {} as Keys;

        this.keyNames.forEach((keyName) => {
            const variableValue = namedArgs[keyName];
            if (variableValue === undefined) {
                throw new Error(`Invalid arguments passed to function- variable ${keyName} is required`);
            }

            out[keyName] = variableValue;
        });

        return out;
    }

    getKeysFromFunc(
        args: IArguments,
        originalFn: any,
    ) {
        const namedArguments = SugarCache.transformIntoNamedArgs(args, originalFn);
        return this.extractKeysFromFunc(
            namedArguments,
        );
    }

    private static ORIGINAL_FN_PROPKEY = 'sugarcache-originalFn';

    /**
     * Decorator to read a value from cache if it exists
     * If it doesn't the target function is called and the return value is set on cache
     */
    memoize<TThis, TArgs extends any[], TReturn>(
        params: MemoizeParams,
    ): DecoratedMethod<TThis, TArgs, TReturn> {
        const cacheInstance = this;
        return (
            target: (_this: TThis, ..._args: TArgs) => TReturn,
            context: ClassMethodDecoratorContext<TThis, (_this: TThis, ..._args: TArgs) => any>,
        ) => {
            const originalFn = Object.getOwnPropertyDescriptor(
                target,
                SugarCache.ORIGINAL_FN_PROPKEY,
            )?.value || target;
            const currentFn = target;

            const { ttl } = params;

            // NOTE(Shantanu)
            // Currently it is not possible to make the type system aware of
            // function parameter names, so we can't throw type errors if keyNames are missing
            // from function params. Current implementation only verifies at compile time
            // Once https://github.com/microsoft/TypeScript/issues/44939 is resolved this can be implemented
            cacheInstance.validateKeys(originalFn, context.name as string);

            const out = async function (): Promise<TReturn> {
                const keys = cacheInstance.getKeysFromFunc(arguments, originalFn);

                const cachedResult = await cacheInstance.get(keys);
                if (cachedResult !== null) {
                    return cachedResult;
                }

                const result = await currentFn.apply(this, arguments);
                await cacheInstance.set(keys, result, ttl)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to set value to cache - ${err}`); });

                return result;
            };

            // Hack to make decorator composable
            Object.defineProperty(out, SugarCache.ORIGINAL_FN_PROPKEY, {
                value: originalFn,
            });

            return out;
        };
    }

    /**
     * Decorator to remove memoized result at a key (computed from function args at runtime)
     * from cache.
     */
    public invalidateMemoized<TThis, TArgs extends any[], TReturn>()
    : DecoratedMethod<TThis, TArgs, TReturn> {
        const cacheInstance = this;
        return function (
            target: ((_this: TThis, ..._args: TArgs) => TReturn) & { metadata?: any },
            context: ClassMethodDecoratorContext<TThis, (_this: TThis, ..._args: TArgs) => any>,
        ) {
            const originalFn = Object.getOwnPropertyDescriptor(
                target,
                SugarCache.ORIGINAL_FN_PROPKEY,
            )?.value || target;
            const currentFn = target;

            // NOTE(Shantanu)
            // Currently it is not possible to make the type system aware of
            // function parameter names, so we can't throw type errors if keyNames are missing
            // from function params. Current implementation only verifies at compile time
            // Once https://github.com/microsoft/TypeScript/issues/44939 is resolved this can be implemented
            cacheInstance.validateKeys(originalFn, context.name as string);

            const out = async function (): Promise<TReturn> {
                const keys = cacheInstance.getKeysFromFunc(arguments, originalFn);

                await cacheInstance.del(keys)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to delete value from cache - ${err}`); });

                const result = await currentFn.apply(this, arguments);

                return result;
            };

            // Hack to make decorator composable
            Object.defineProperty(out, SugarCache.ORIGINAL_FN_PROPKEY, {
                value: originalFn,
            });

            return out;
        };
    }

    /**
     * Decorator to execute a function and set the return value to cache.
     * This will replace any previously memoized value for the key being operated on.
     * Key difference between this and the `memoize` decorator is that
     * this always executes the decorated function, whereas the latter will not
     * execute if a memoized value is found.
     */
    public updateMemoized<TThis, TArgs extends any[], TReturn>(
        params: UpdateMemoizedParams,
    ): DecoratedMethod<TThis, TArgs, TReturn> {
        const cacheInstance = this;
        return function (
            target: ((_this: TThis, ..._args: TArgs) => any) & { metadata?: any },
            context: ClassMethodDecoratorContext<TThis, (_this: TThis, ..._args: TArgs) => any>,
        ) {
            const originalFn = Object.getOwnPropertyDescriptor(
                target,
                SugarCache.ORIGINAL_FN_PROPKEY,
            )?.value || target;
            const currentFn = target;

            const { ttl } = params;
            // NOTE(Shantanu)
            // Currently it is not possible to make the type system aware of
            // function parameter names, so we can't throw type errors if keyNames are missing
            // from function params. Current implementation only verifies at compile time
            // Once https://github.com/microsoft/TypeScript/issues/44939 is resolved this can be implemented
            cacheInstance.validateKeys(originalFn, context.name as string);

            const out = async function (): Promise<TReturn> {
                const keys = cacheInstance.getKeysFromFunc(arguments, originalFn);
                const result = await currentFn.apply(this, arguments);

                const value = result;
                // if (accumulator) {
                //     const memoizedValue = await cacheInstance.get(
                //    keys) ?? accumulator.initialValue;
                //     value = accumulator.fn(memoizedValue, result);
                // }
                await cacheInstance.set(keys, value, ttl)
                    .catch((err) => { throw new Error(`[SugarCache:${cacheInstance.namespace}] Unable to set value to cache - ${err}`); });

                return result;
            };

            // Hack to make decorator composable
            Object.defineProperty(out, SugarCache.ORIGINAL_FN_PROPKEY, {
                value: originalFn,
            });

            return out;
        };
    }
}
