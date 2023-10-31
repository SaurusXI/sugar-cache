/* eslint-disable no-param-reassign */
import Redis, { Cluster } from 'ioredis';
import { CreateCacheOptions, TTL } from '../types';
import { Logger } from '../types/logging';
import InMemoryCache from './memory';
import RedisCache from './redis';

export default class MultilevelCache {
    private redisCache: RedisCache;

    private inMemoryCache: InMemoryCache;

    public namespace: string;

    constructor(options: CreateCacheOptions, redis: Redis | Cluster, logger?: Logger) {
        this.namespace = `sugar-cache:${options.namespace || 'default'}`;
        options.namespace = this.namespace;

        this.redisCache = new RedisCache(redis, options, logger);
        this.inMemoryCache = new InMemoryCache(options, logger);
    }

    public get = async (
        keys: string[],
    ) => (this.inMemoryCache.get(keys)) ?? (this.redisCache.get(keys));

    public set = async (
        keys: string[],
        value: any,
        ttls: { redis: TTL, memory: TTL },
    ) => Promise.all([
        this.redisCache.set(keys, value, ttls.redis),
        this.inMemoryCache.set(keys, value, ttls.memory),
    ]);

    public del = async (
        keys: string[],
    ) => Promise.all([this.redisCache.del(keys), this.inMemoryCache.del(keys)]);

    public clear = async () => Promise.all([this.redisCache.clear(), this.inMemoryCache.clear()]);
}
