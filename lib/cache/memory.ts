import { memoryUsage } from 'node:process';
import { CreateCacheOptions, TTL } from '../types';
import { Logger } from '../types/logging';
import BaseCache from './base';

export default class InMemoryCache extends BaseCache {
    private cache: Map<string, any>;

    private enabled: boolean;

    private memUsageThreshold: number;

    constructor(options: CreateCacheOptions, logger?: Logger) {
        const { namespace, inMemoryCache: inMemoryCacheOptions } = options;
        super(namespace, logger);
        this.enabled = inMemoryCacheOptions?.enable ?? true;
        this.memUsageThreshold = inMemoryCacheOptions?.memoryThresholdPercentage ?? 0.5;
        this.cache = new Map<string, any>();
    }

    public get = (keys: string[]) => {
        if (!this.enabled) {
            return null;
        }
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        const result = this.cache.get(cacheKey);
        return result ?? null;
    };

    public set = (keys: string[], value: any, ttl: TTL) => {
        if (!this.enabled) {
            return;
        }

        const memorySnapshot = memoryUsage();
        const memUsed = memorySnapshot.heapUsed / memorySnapshot.heapTotal;
        if (memUsed >= this.memUsageThreshold) {
            return;
        }

        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        this.cache.set(cacheKey, value);
        setTimeout(() => this.del(keys), this.computeTTLInMilliseconds(ttl));
    };

    public del = (keys: string[]) => {
        if (!this.enabled) {
            return;
        }
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        this.cache.delete(cacheKey);
    };

    public clear = () => this.enabled && this.cache.clear();
}
