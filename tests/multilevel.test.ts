import Redis from "ioredis";
import SugarCache from "../lib/main";

/**
 * Testing strategy here is to mock a redis connection that always returns a fixed value
 * We can then check if results are returned by redis by comparing values
 */
class MockRedis {
    static returnVal = 'REDIS_RESULT';

    multi() {
        return new MockRedis();
    }

    get(v: any) {
        return new MockRedis();
    }

    set(...args: any[]) {
        return new MockRedis();
    }

    async exec() {
        return MockRedis.returnVal;
    }
}

const resourceId = 'resource-UUID';

describe('Multilevel caching', () => {
    const cacheWithMockedRedis = new SugarCache(new MockRedis() as unknown as Redis, { namespace: 'multilevel' });

    class Controller {
        static mockLatency = 3000;

        static returnVal = 'RETURN_VAL';

        @cacheWithMockedRedis.cacheFnResult({
            keyVariables: ['resourceId'],
            ttl: 3000
        })
        async get_fixedTTL(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal; 
        }

        @cacheWithMockedRedis.cacheFnResult({
            keyVariables: ['resourceId'],
            ttl: {
                memory: 10,
                redis: 3000,
            }
        })
        async get_memoryDiesFirst(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal;
        }

        @cacheWithMockedRedis.cacheFnResult({
            keyVariables: ['resourceId'],
            ttl: {
                memory: 3000,
                redis: 10,
            }
        })
        async get_redisDiesFirst(resourceId: string) {
            await new Promise((resolve) => setTimeout(resolve, Controller.mockLatency));
            return Controller.returnVal;
        }
    }

    const controller = new Controller();

    it('TTL Redis = TTL Memory', async () => {
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
        // Second call to get value
        const result = await controller.get_memoryDiesFirst(resourceId);
        // Value is returned from redis
        expect(result).toStrictEqual(MockRedis.returnVal);
    })

    it('TTL Redis < TTL Memory', async () => {
        await cacheWithMockedRedis.clear();
        // First call to put the value on cache
        await controller.get_redisDiesFirst(resourceId);
        // Second call to get value
        const result = await controller.get_redisDiesFirst(resourceId);
        // Value is returned from memory, so should be the actual value being returned by controller
        expect(result).toStrictEqual(Controller.returnVal);
    },
    // Since there are two controller calls and the second one is cached, upper bound is 2*mockLatency
    Controller.mockLatency * 2)
})

describe('Memory threshold test', async () => {
    const cacheWithZeroMemoryThreshold = new SugarCache(new MockRedis() as unknown as Redis, {
        namespace: 'zero-memory-threshold',
        inMemoryCache: { memoryThresholdPercentage: 0, enable: true }
    });

    it('When memory threshold is exceeded, value is read from redis', async () => {
        const cachedResult = 'IN_MEMORY_RESULT';
        await cacheWithZeroMemoryThreshold.set([resourceId], cachedResult, 10000);
        const result = await cacheWithZeroMemoryThreshold.get([resourceId]);
        expect(result).toStrictEqual(MockRedis.returnVal);
    })
})
