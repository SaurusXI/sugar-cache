import { memoryUsage } from 'node:process';
import { Summary } from 'prom-client';
import { CreateCacheOptions, TTL } from '../types';
import { Logger } from '../types/logging';
import Cache from './base';

export default class InMemoryCache extends Cache {
    private cache: Map<string, any>;

    private ttlTimers: Map<string, NodeJS.Timeout>;

    private enabled: boolean;

    private memUsageThreshold: number;

    private cacheHitRatio: Summary;

    constructor(options: CreateCacheOptions<any>, logger?: Logger) {
        const { namespace, inMemoryCache: inMemoryCacheOptions, prometheusClient } = options;
        super(namespace, prometheusClient, logger);
        this.enabled = inMemoryCacheOptions?.enable ?? true;
        this.memUsageThreshold = inMemoryCacheOptions?.memoryThresholdPercentage ?? 0.5;
        this.cache = new Map<string, any>();
        this.ttlTimers = new Map();
        if (prometheusClient) {
            this.cacheHitRatio = new prometheusClient.Summary({
                name: 'sugarcache_memory_cache_hit_ratio',
                help: 'Sugar-cache cache hit ratio in memory',
            });
        }
    }

    public get = (keys: string[]) => {
        if (!this.enabled) {
            return null;
        }
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        const result = this.cache.get(cacheKey) ?? null;

        if (result) {
            this.cacheHitRatio?.observe(1);
            this.logger.debug(`[SugarCache:${this.namespace}]: key ${cacheKey} found in memory, returning...`);
        } else {
            this.cacheHitRatio?.observe(0);
        }
        return result;
    };

    public set = (keys: string[], value: any, ttl: TTL) => {
        if (!this.enabled) {
            return;
        }

        const memorySnapshot = memoryUsage();
        const memUsed = memorySnapshot.heapUsed / memorySnapshot.heapTotal;
        if (memUsed >= this.memUsageThreshold) {
            this.logger.warn(`[SugarCache:${this.namespace}]: Memory usage threshold exceeded, not writing to cache`);
            return;
        }

        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        this.cache.set(cacheKey, value);
        const ttlTimer = setTimeout(() => this.del(keys), this.computeTTLInMilliseconds(ttl));
        this.ttlTimers.set(cacheKey, ttlTimer);

        this.logger.debug(`[SugarCache:${this.namespace}]: Set key ${cacheKey} in memory`);
    };

    public del = (keys: string[]) => {
        if (!this.enabled) {
            return;
        }
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        this.cache.delete(cacheKey);

        const ttlTimer = this.ttlTimers.get(cacheKey);
        if (ttlTimer) {
            clearTimeout(ttlTimer);
        }

        this.logger.debug(`[SugarCache:${this.namespace}]: Deleted key ${cacheKey} from memory`);
    };

    public clear = () => this.enabled && this.cache.clear();
}
