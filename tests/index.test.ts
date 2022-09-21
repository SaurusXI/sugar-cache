import Redis from 'ioredis';
import RedisCache from '../lib';


describe('Functional tests', () => {
    const redis = new Redis({
        port: 6379,
        host: '127.0.0.1'
    });

    const baseCacheWidth = 3;
    const largeCacheWidth = 10000;
    const ttl = 10000;
    
    describe('Basic cache', () => {
        const cacheBasic = new RedisCache(redis, { width: baseCacheWidth, namespace: 'basic' });
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };
        
        const mockCacheVals = [...Array(baseCacheWidth).keys()].map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))

        it('write', async () => {
            await cacheBasic.reset();
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
            await cacheBasic.reset();
            for (const mockObj of mockCacheVals) {
                await cacheBasic.set(mockObj.key, mockObj.val);
            }
            
            // Now insert value into cache and see what happens
            await cacheBasic.set(mockKey, mockVal);
            const cachedVal = await cacheBasic.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);

            for (const mockObj of mockCacheVals) {
                // Since the first element was inserted first, expect that to be omitted
                const cachedVal = await cacheBasic.get(mockObj.key);
                if (mockObj === mockCacheVals[0]) {
                    expect(cachedVal).toBeNull();
                } else {
                    expect(cachedVal).toStrictEqual(mockObj.val);
                }
            }
        })

        describe('Decorator methods', () => {
            const mockLatency = 3000;

            class Controller {
                @cacheBasic.getOrSet(['orgId', 'resourceId'])
                async read(resourceId: string, orgId: string) {
                    // Introduce mock latency which will not happen when the cache is hit
                    await new Promise((resolve) => setTimeout(resolve, mockLatency));
                    return { res: orgId + resourceId };
                }

                @cacheBasic.invalidate(['orgId', 'resourceId'])
                async delete(resourceId: string, orgId: string) {
                    return { res: orgId + resourceId };
                }
            }
             
            const controller = new Controller();
            const orgId = 'org-uuid';
            const resourceId = 'resource-uuid';

            it('getOrSet first call', async () => {
                const response = await controller.read(resourceId, orgId);
                expect(response).toStrictEqual({ res: orgId + resourceId });
            });

            it('getOrSet cached call', async () => {
                const response = await controller.read(resourceId, orgId);
                expect(response).toStrictEqual({ res: orgId + resourceId });
            }, mockLatency);

            it('invalidate', async () => {
                const response = await controller.delete(resourceId, orgId);
                expect(response).toStrictEqual({ res: orgId + resourceId });
                const cachedValue = await cacheBasic.get(`${orgId}:${resourceId}`);
                expect(cachedValue).toBeNull();
            })
        })
    })
    
    describe('TTL cache', () => {
        const cacheTtl = new RedisCache(redis, { width: baseCacheWidth, ttl, namespace: 'ttl' });
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(baseCacheWidth).keys()].map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))
        
        it('write', async () => {
            await cacheTtl.reset();
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
        }, 2*ttl)
        
        it('delete', async () => {
            await cacheTtl.del(mockKey);
            
            const cachedVal = await cacheTtl.get(mockKey);
            expect(cachedVal).toBeNull();
        })
        
        it('cache eviction', async () => {
            await cacheTtl.reset();
            for (const mockObj of mockCacheVals) {
                await cacheTtl.set(mockObj.key, mockObj.val);
            }
            
            // Now insert value into cache and see what happens
            await cacheTtl.set(mockKey, mockVal);
            const cachedVal = await cacheTtl.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);

            for (const mockObj of mockCacheVals) {
                // Since the first element was inserted first, expect that to be omitted
                const cachedVal = await cacheTtl.get(mockObj.key);
                if (mockObj === mockCacheVals[0]) {
                    expect(cachedVal).toBeNull();
                } else {
                    expect(cachedVal).toStrictEqual(mockObj.val);
                }
            }
        })
    })

    describe('Large cache', () => {
        const cacheLarge = new RedisCache(redis, { width: largeCacheWidth, namespace: 'large' });
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(largeCacheWidth).keys()].map(x => ({ key: `foo-${x}`, val: `bar-${x}` }))

        it('write', async () => {
            await cacheLarge.reset();
            await cacheLarge.set(mockKey, mockVal);
        })

        it('read', async () => {
            const cachedVal = await cacheLarge.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);
        })

        it('delete', async () => {
            await cacheLarge.del(mockKey);

            const cachedVal = await cacheLarge.get(mockKey);
            expect(cachedVal).toBeNull();
        })

        it.skip('cache eviction', async () => {
            await cacheLarge.reset();
            for (const mockObj of mockCacheVals) {
                await cacheLarge.set(mockObj.key, mockObj.val);
            }
            
            // Now insert value into cache and see what happens
            await cacheLarge.set(mockKey, mockVal);
            const cachedVal = await cacheLarge.get(mockKey);
            expect(cachedVal).toStrictEqual(mockVal);

            for (const mockObj of mockCacheVals) {
                // Since the first element was inserted first, expect that to be omitted
                const cachedVal = await cacheLarge.get(mockObj.key);
                if (mockObj === mockCacheVals[0]) {
                    expect(cachedVal).toBeNull();
                } else {
                    expect(cachedVal).toStrictEqual(mockObj.val);
                }
            }
        })
    })
})