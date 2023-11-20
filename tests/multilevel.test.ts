import Redis from "ioredis";
import SugarCache from "../lib/main";
import { logger } from './index.test';

const resourceId = 'resource-UUID';

const redis = new Redis({
    port: 6379,
    host: '127.0.0.1',
});

const mockRedisReturnVal = 'REDIS_VAL';

describe('Multilevel caching', () => {
    const cacheWithMockedRedis = new SugarCache<'resourceId'>(redis, { namespace: 'multilevel', inMemoryCache: { enable: true, memoryThresholdPercentage: 0.9} });

    class Controller {
        static mockLatency = 500;

        static lowTTL = 10;

        static highTTL = 100;

        static returnVal = 'RETURN_VAL';

        @cacheWithMockedRedis.cacheFnResult({
            variableNames: { resourceId: 'resourceId' },
            ttl: 100
        })
        async get_fixedTTL(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal; 
        }

        @cacheWithMockedRedis.cacheFnResult({
            variableNames: { resourceId: 'resourceId' },
            ttl: {
                memory: Controller.lowTTL,
                redis: Controller.highTTL,
            }
        })
        async get_memoryDiesFirst(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal;
        }

        @cacheWithMockedRedis.cacheFnResult({
            variableNames: { resourceId: 'resourceId' },
            ttl: {
                memory: Controller.highTTL,
                redis: Controller.lowTTL,
            }
        })
        async get_redisDiesFirst(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal;
        }
    }

    const controller = new Controller();

    it('TTL Redis = TTL Memory', async () => {
        await cacheWithMockedRedis.clear();

        // First call to put the value on cache
        await controller.get_fixedTTL(resourceId);
        // Second call to get value
        const result = await controller.get_fixedTTL(resourceId);
        // Value is returned from memory, so should be the actual value being returned by controller
        expect(result).toStrictEqual(Controller.returnVal);
    },
    // Since there are two controller calls and the second one is cached, upper bound is 2*mockLatency
    Controller.mockLatency * 2)

    it('TTL Redis > TTL Memory', async () => {
        await cacheWithMockedRedis.clear();
        // First call to put the value on cache
        await controller.get_memoryDiesFirst(resourceId);

        await new Promise((resolve) => setTimeout(resolve, 1.1 * Controller.lowTTL));
    
        // Second call to get value
        const result = await controller.get_memoryDiesFirst(resourceId);
        // Value is returned from redis
        expect(result).toStrictEqual(Controller.returnVal);

        // Teardown to free timers
        await cacheWithMockedRedis.del({ resourceId });
    })

    it('TTL Redis < TTL Memory', async () => {
        await cacheWithMockedRedis.clear();
        // First call to put the value on cache
        await controller.get_redisDiesFirst(resourceId);

        await new Promise((resolve) => setTimeout(resolve, 1.1 * Controller.lowTTL));
        // Second call to get value
        const result = await controller.get_redisDiesFirst(resourceId);
        // Value is returned from memory, so should be the actual value being returned by controller
        expect(result).toStrictEqual(Controller.returnVal);
    },
    // Since there are two controller calls and the second one is cached, upper bound is 2*mockLatency
    Controller.mockLatency * 2)
})

describe('Memory threshold test', () => {
    const cacheWithZeroMemoryThreshold = new SugarCache<'resourceId'>(redis, {
        namespace: 'zero-memory-threshold',
        inMemoryCache: { memoryThresholdPercentage: 0, enable: true }
    });

    it('When memory threshold is exceeded, value is read from redis', async () => {
        const cachedResult = 'IN_MEMORY_RESULT';
        await cacheWithZeroMemoryThreshold.set({ resourceId }, cachedResult, 10000);
        const result = await cacheWithZeroMemoryThreshold.get({ resourceId });
        expect(result).toStrictEqual(cachedResult);
    })
})
