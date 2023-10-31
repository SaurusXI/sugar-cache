/**
 * @param namespace Namespace of cache. All caches without this value set share a default namespace
 */
export type CreateCacheOptions = {
    namespace?: string;
    inMemoryCache?: {
        enable?: boolean,
        /**
         * The in-memory cache will not write to cache if this threshold is breached
         * This is done to avoid over-consumption of application memory for caching.
         */
        memoryThresholdPercentage: number,
    }
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
export type TTLOptions = {
    redis: TTL,
    memory: TTL,
};

export type CacheFnResultParams = {
    /**
     * Ordered list of identifiers for value in cache
     */
    keyVariables: string[];
    ttl: TTL | TTLOptions;
}

export type InvalidateFromCacheParams = {
    keyVariables: string[];
}
