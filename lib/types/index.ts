/**
 * @param namespace Namespace of cache. All caches without this value set share a default namespace
 */
export type CreateCacheOptions = {
    namespace?: string;
}

/**
 * TTL of kv pairs in cache. If this is a number, its considered to be in milliseconds
 */
export type TTL = number | {
    value: number,
    unit: 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days'
};

export type CacheResultParams = {
    keyVariables: string[];
    ttl: TTL;
}

export type InvalidateFromCacheParams = {
    keyVariables: string[];
}
