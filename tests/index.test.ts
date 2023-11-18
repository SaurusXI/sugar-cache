import Redis from 'ioredis';
import SugarCache from '../lib/main';

export const logger = {
    info: (message: string, ...args: any[]) => console.log(message),
    debug: (message: string, ...args: any[]) => console.log(message),
    warn: (message: string, ...args: any[]) => console.log(message),
    error: (message: string, ...args: any[]) => console.log(message),
}

describe('Functional tests', () => {
    const redis = new Redis({
        port: 6379,
        host: '127.0.0.1',
    });

    const ttl = 2000;

    const totTestKeys = 100;

    describe('Basic cache', () => {
        const cacheBasic = new SugarCache<'mockKey'>(redis, { namespace: 'basic' });
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(totTestKeys).keys()].map((x) => ({ key: `foo-${x}`, val: `bar-${x}` }));

        it('write', async () => {
            await cacheBasic.set({ mockKey }, mockVal, ttl);
        });

        it('read', async () => {
            const cachedVal = await cacheBasic.get({ mockKey });
            expect(cachedVal).toStrictEqual(mockVal);
        });

        it('delete', async () => {
            await cacheBasic.del({ mockKey });
            const cachedVal = await cacheBasic.get({ mockKey });
            expect(cachedVal).toBeNull();
        });

        it('clear cache', async () => {
            for (const mockObj of mockCacheVals) {
                await cacheBasic.set({ mockKey: mockObj.key }, mockObj.val, ttl);
            }
            await cacheBasic.clear();
            for (const mockObj of mockCacheVals) {
                // Since the first element was inserted first, expect that to be omitted
                const cachedVal = await cacheBasic.get({ mockKey: mockObj.key });
                expect(cachedVal).toBeNull();
            }
        });

        it('TTL based eviction', async () => {
            await cacheBasic.set({ mockKey }, mockVal, ttl);
            await new Promise((resolve) => {
                setTimeout(resolve, ttl * 1.1);
            });
            const cachedVal = await cacheBasic.get({ mockKey });
            expect(cachedVal).toBeNull();
        }, 2 * ttl);

        describe('Decorator methods', () => {
            const mockLatency = 3000;

            const cacheBasic = new SugarCache<'category' | 'id'>(redis, { namespace: 'secondBasic' });

            const secondCacheBasic = new SugarCache<'category'>(redis, { namespace: 'secondBasic' });

            class Controller {
                @cacheBasic.cacheFnResult({
                    keyVariables: {
                        id: 'resourceId',
                        category: 'resourceCategory',
                    },
                    ttl,
                })
                async read(resourceId: string, resourceCategory: string) {
                    // Introduce mock latency which will not happen when the cache is hit
                    await new Promise((resolve) => setTimeout(resolve, mockLatency));
                    return { res: resourceCategory + resourceId };
                }

                @cacheBasic.invalidateFromCache({
                    keyVariables: {
                        id: 'resourceId',
                        category: 'resourceCategory'
                    },
                })
                async delete(resourceId: string, resourceCategory: string) {
                    return { res: resourceCategory + resourceId };
                }

                @secondCacheBasic.cacheFnResult({ keyVariables: { category: 'orgId'}, ttl })
                @cacheBasic.cacheFnResult({ keyVariables: { id: 'orgId', category: 'resourceId' }, ttl })
                async compoundRead(resourceId: string, orgId: string) {
                    // Introduce mock latency which will not happen when the cache is hit
                    await new Promise((resolve) => setTimeout(resolve, mockLatency));
                    return { res: orgId + resourceId };
                }
            }
            const controller = new Controller();
            const resourceCategory = 'org-uuid';
            const resourceId = 'resource-uuid';

            it('cacheFnResult first call', async () => {
                await cacheBasic.clear();
                const response = await controller.read(resourceId, resourceCategory);
                expect(response).toStrictEqual({ res: resourceCategory + resourceId });
            });

            it('cacheFnResult cached call', async () => {
                const response = await controller.read(resourceId, resourceCategory);
                expect(response).toStrictEqual({ res: resourceCategory + resourceId });
            }, (mockLatency / 2));

            it('invalidate', async () => {
                const response = await controller.delete(resourceId, resourceCategory);
                expect(response).toStrictEqual({ res: resourceCategory + resourceId });
                const cachedValue = await cacheBasic.get({ category: resourceCategory, id: resourceId });
                expect(cachedValue).toBeNull();
            });

            it('compound cacheFnResult first call', async () => {
                await secondCacheBasic.clear();
                const response = await controller.compoundRead(resourceId, resourceCategory);
                expect(response).toStrictEqual({ res: resourceCategory + resourceId });
            });

            it('compound cacheFnResult cached call', async () => {
                const response = await controller.compoundRead(resourceId, resourceCategory);
                expect(response).toStrictEqual({ res: resourceCategory + resourceId });
            }, mockLatency);
        });
    });

    describe('Basic cache with redis cluster', () => {
        const redisCluster = new Redis.Cluster([{ host: '127.0.0.1', port: 6380 }]);
        const cacheBasic = new SugarCache<'mockKey'>(redisCluster, { namespace: 'cluster' });
        const mockKey = 'foo';
        const mockVal = { res: 'bar' };

        const mockCacheVals = [...Array(totTestKeys).keys()].map((x) => ({ key: `foo-${x}`, val: `bar-${x}` }));

        it('write', async () => {
            await cacheBasic.set({ mockKey }, mockVal, ttl);
        });

        it('read', async () => {
            const cachedVal = await cacheBasic.get({ mockKey });
            expect(cachedVal).toStrictEqual(mockVal);
        });

        it('delete', async () => {
            await cacheBasic.del({ mockKey });

            const cachedVal = await cacheBasic.get({ mockKey });
            expect(cachedVal).toBeNull();
        });

        it('clear cache', async () => {
            for (const mockObj of mockCacheVals) {
                await cacheBasic.set({ mockKey: mockObj.key }, mockObj.val, ttl);
            }
            await cacheBasic.clear();
            for (const mockObj of mockCacheVals) {
                // Since the first element was inserted first, expect that to be omitted
                const cachedVal = await cacheBasic.get({ mockKey: mockObj.key });
                expect(cachedVal).toBeNull();
            }
        });
    });
});
