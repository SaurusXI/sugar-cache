import client from 'prom-client';

export type PrometheusClient = typeof client;

/**
 * @param namespace Namespace of cache. All caches without this value set share a default namespace
 */
export type CreateCacheOptions<KeyName extends string> = {
    namespace?: string;
    inMemoryCache?: {
        enable?: boolean,
        /**
         * The in-memory cache will not write to cache if this threshold is breached
         * This is done to avoid over-consumption of application memory for caching.
         * If not specified, the default value is 50%
         */
        memoryThresholdPercentage?: number,
    },
    /**
     * Keys to use with hashtags. This is required to avoid `CROSS SLOT` redis errors
     * when using batched operations (`mset`, `mget`, `mdel`) on a clustered redis connection.
     * https://redis.io/docs/reference/cluster-spec/#hash-tags
     */
    hashtags?: { [_Property in KeyName]?: boolean },
    prometheusClient?: PrometheusClient;
}

/**
 * TTL of kv pairs in cache. If this is a number, its considered to be in milliseconds
 */
export type TTL = number | {
    value: number,
    unit: 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days'
};

/**
 * Granular TTL specification for memory and redis caches
 */
export type CachewiseTTL = {
    redis: TTL,
    memory: TTL,
};

export type VariablesByKeys<T> = {
    [_Property in keyof T]: string
};

export type MemoizeParams<T> = {
    /**
     * Object mapping cache keys to function args
     */
    argnamesByKeys: VariablesByKeys<T>;
    ttl: TTL | CachewiseTTL;
}

export type InvalidateMemoizedParams<T> = {
    /**
     * Object mapping function arguments to cache keys
     */
    argnamesByKeys: VariablesByKeys<T>;
}
