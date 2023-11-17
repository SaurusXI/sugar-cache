/* eslint-disable no-param-reassign */
import Redis, { Cluster } from 'ioredis';
import { CreateCacheOptions, TTLOptions } from '../types';
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
        ttls: TTLOptions,
    ) => Promise.all([
        this.redisCache.set(keys, value, ttls.redis),
        this.inMemoryCache.set(keys, value, ttls.memory),
    ]);

    public del = async (
        keys: string[],
    ) => Promise.all([this.redisCache.del(keys), this.inMemoryCache.del(keys)]);

    public clear = async () => Promise.all([this.redisCache.clear(), this.inMemoryCache.clear()]);

    public mget = async (keys: string[][]) => {
        const inMemoryResults = keys.map(this.inMemoryCache.get);

        const redisQueryKeys = keys.filter((_, idx) => inMemoryResults[idx] === null);
        const redisCacheResults = await this.redisCache.batchGet(redisQueryKeys);

        let redisIdx = 0;
        const out: any[] = [];
        inMemoryResults.forEach((val, i) => {
            if (val === null && redisIdx < redisCacheResults.length) {
                out[i] = redisCacheResults[redisIdx];
                redisIdx += 1;
            } else {
                out[i] = val;
            }
        });

        return out;
    };

    public mset = async (keys: string[][], values: any[], ttls: TTLOptions) => {
        if (keys.length !== values.length) {
            throw new Error('Length of keys and values is not the same');
        }

        keys.forEach((key, idx) => {
            this.inMemoryCache.set(key, values[idx], ttls.memory);
        });
        await this.redisCache.batchSet(keys, values, ttls.redis);
    };

    public mdel = async (keys: string[][]) => {
        keys.forEach(this.inMemoryCache.del);
        await this.redisCache.batchDel(keys);
    };
}
