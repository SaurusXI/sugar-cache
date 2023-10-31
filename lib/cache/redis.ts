import { Cluster, Redis } from 'ioredis';
import { RedisExpiryModes } from '../constants';
import { CreateCacheOptions, TTL } from '../types';
import { Logger } from '../types/logging';
import BaseCache from './base';

export default class RedisCache extends BaseCache {
    private redis: Redis | Cluster;

    constructor(redis: Redis | Cluster, options: CreateCacheOptions, logger?: Logger) {
        const { namespace } = options;
        super(namespace, logger);
        this.redis = redis;
    }

    private redisTransaction = () => this.redis.multi();

    public get = async (keys: string[]) => {
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        const result = await this.redisTransaction()
            // fetch value
            .get(cacheKey)
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });

        const [_, value] = result[0];

        let output;
        try {
            output = JSON.parse(value as string);
        } catch (err) {
            this.logger.debug(`[SugarCache:${this.namespace}] Error encountered in parsing - ${err}`);
            output = null;
        }
        return output;
    };

    public set = async (keys: string[], value: any, ttl: TTL) => {
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        const result = await this.redisTransaction()
            // set value in cache
            .set(
                cacheKey,
                JSON.stringify(value),
                RedisExpiryModes.Milliseconds,
                this.computeTTLInMilliseconds(ttl),
            )
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });
    };

    public del = async (keys: string[]) => {
        const key = keys.join(':');
        const cacheKey = this.transformIntoCacheKey(key);

        const result = await this.redisTransaction()
            .del(cacheKey)
            .exec();

        result.forEach(([err, _]) => {
            if (err) {
                this.logger.debug(`[SugarCache:${this.namespace}] error encountered on redis layer - ${err}`);
                throw new Error('[SugarCache] Internal redis error');
            }
        });
    };

    public clear = async () => {
        if (this.redis instanceof Cluster) {
            const deletionCandidateKeysMap = await Promise.all((this.redis as Cluster).nodes('master')
                .map(async (node) => node.keys(`${this.namespace}*`)));
            const deletionCandidateKeys = [].concat(...deletionCandidateKeysMap);
            this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidate keys - ${deletionCandidateKeys}`);
            await Promise.all(deletionCandidateKeys.map((k) => this.redis.del(k)));
            this.logger.debug(`[SugarCache:${this.namespace}] Deletion keys removed`);
            return;
        }
        const deletionCandidateKeys = await this.redis.keys(`${this.namespace}*`);

        this.logger.debug(`[SugarCache:${this.namespace}] Deletion candidate keys - ${deletionCandidateKeys}`);
        if (!deletionCandidateKeys.length) return;

        await this.redis.del(deletionCandidateKeys);

        this.logger.debug(`[SugarCache:${this.namespace}] Deletion keys removed`);
    };
}