import Redis from "ioredis"
import SugarCache from "../lib/main";
import { logger } from './index.test';

describe('Batched operations', () => {
    const redis = new Redis({
        port: 6379,
        host: '127.0.0.1',
    });

    const cache = new SugarCache(redis, {
        namespace: 'batched-ops',
        keys: ['mockKey']
    })

    const mockCacheVals = [...Array(2).keys()].map((x) => ({ key: `foo-${x}`, val: `bar-${x}` }));

    const keys = mockCacheVals.map((v) => ({ mockKey: v.key })).slice(0, 2);
    const vals = mockCacheVals.map((v) => v.val).slice(0, 2);

    it('mset values can be get individually', async () => {
        await cache.clear();
        
        await cache.mset(keys, vals, 5000);
        const v0 = await cache.get(keys[0]);
        const v1 = await cache.get(keys[1]);
        
        expect(v0).toStrictEqual(vals[0]);
        expect(v1).toStrictEqual(vals[1]);
    })
    
    it('mset values can be mget', async () => {
        await cache.clear();

        await cache.mset(keys, vals, 5000);
        const cachedVals = await cache.mget(keys);

        expect(cachedVals).toStrictEqual(vals);
    })

    it('Individually set values can be mget', async () => {
        await cache.clear();

        await cache.set(keys[0], vals[0], 5000);
        await cache.set(keys[1], vals[1], 5000);
        const cachedVals = await cache.mget(keys);

        expect(cachedVals).toStrictEqual(vals);
    })

    it('mdel values cannot be get or mget', async () => {
        await cache.clear();

        await cache.mset(keys, vals, 5000);
        await cache.mdel(keys);

        const cachedVals = await cache.mget(keys);
        expect(cachedVals).toStrictEqual([null, null]);

        const v0 = await cache.get(keys[0]);
        const v1 = await cache.get(keys[1]);

        expect(v0).toBeNull();
        expect(v1).toBeNull();
    })
})