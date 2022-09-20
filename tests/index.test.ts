import Redis from 'ioredis';
import RedisCache from '../lib';


describe('Functional tests', () => {
    const redis = new Redis({
        port: 6379,
        host: '127.0.0.1'
    });

    const baseCacheWidth = 10;
    const largeCacheWidth = 10000;
    const ttl = 10000;

    const cacheBasic = new RedisCache(redis, { width: baseCacheWidth, namespace: 'basic' });
    const cacheTtl = new RedisCache(redis, { width: baseCacheWidth, ttl, namespace: 'ttl' });
    const cacheLarge = new RedisCache(redis, { width: largeCacheWidth, namespace: 'large' });
    
    describe('Basic cache', () => {
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(baseCacheWidth).map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))]

        it('write', async () => {
            await cacheBasic.set(mockKey, mockVal);
        })

        it('read', async () => {
            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })

        it('delete', async () => {
            await cacheBasic.del(mockKey);

            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toBeNull();
        })

        it('cache eviction', async () => {
            await Promise.all(mockCacheVals.map(async (mockObj) => {
                await cacheBasic.set(mockObj.key, mockObj.val);
            }));
            
            // Now insert value into cache and see what happens
            await cacheBasic.set(mockKey, mockVal);
            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })
    })

    describe('TTL cache', () => {
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(baseCacheWidth).map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))]

        it('write', async () => {
            await cacheTtl.set(mockKey, mockVal);
        })

        it('read', async () => {
            const cachedVal = await cacheTtl.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })

        it('TTL based eviction', async () => {
            await cacheTtl.set(mockKey, mockVal);
            await new Promise((resolve) => {
                setTimeout(resolve, ttl)
            });
            const cachedVal = await cacheTtl.get(mockKey);
            expect(cachedVal).toBeNull();
        })

        it('delete', async () => {
            await cacheTtl.del(mockKey);

            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toBeNull();
        })

        it('cache eviction', async () => {
            await Promise.all(mockCacheVals.map(async (mockObj) => {
                await cacheTtl.set(mockObj.key, mockObj.val);
            }));
            
            // Now insert value into cache and see what happens
            await cacheTtl.set(mockKey, mockVal);
            const cachedVal = await cacheTtl.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })
    })

    describe('Large cache', () => {
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(baseCacheWidth).map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))]

        it('write', async () => {
            await cacheLarge.set(mockKey, mockVal);
        })

        it('read', async () => {
            const cachedVal = await cacheLarge.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })

        it('delete', async () => {
            await cacheLarge.del(mockKey);

            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toBeNull();
        })

        it('cache eviction', async () => {
            await Promise.all(mockCacheVals.map(async (mockObj) => {
                await cacheLarge.set(mockObj.key, mockObj.val);
            }));
            
            // Now insert value into cache and see what happens
            await cacheLarge.set(mockKey, mockVal);
            const cachedVal = await cacheLarge.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })
    })
})