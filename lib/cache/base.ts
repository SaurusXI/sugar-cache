import readFunctionParams from '@captemulation/get-parameter-names';
import { dummyLogger, Logger } from '../types/logging';
import { TTL } from '../types';

export default abstract class BaseCache {
    protected namespace: string;

    protected readonly logger: Logger;

    constructor(namespace: string, logger: Logger = dummyLogger) {
        this.namespace = namespace;
        this.logger = logger;
    }

    protected transformIntoCacheKey = (key: string) => `${this.namespace}:${key}`;

    protected computeTTLInMilliseconds = (ttl: TTL) => {
        if (typeof ttl === 'number') {
            return ttl;
        }
        const { value, unit } = ttl;
        switch (unit) {
        case 'milliseconds': {
            return value;
        }
        case 'seconds': {
            return value * 1000;
        }
        case 'minutes': {
            return value * 1000 * 60;
        }
        case 'hours': {
            return value * 1000 * 60 * 60;
        }
        case 'days': {
            return value * 1000 * 60 * 60 * 24;
        }
        default: {
            throw new Error(`[SugarCache]:${this.namespace} Incorrect TTL unit provided to constructor`);
        }
        }
    };

    protected validateKeys = (targetFn: any, cacheKeys: string[]) => {
        const params = readFunctionParams(targetFn);
        const invalidKeys = cacheKeys.filter((k) => !params.includes(k));

        if (invalidKeys.length) {
            this.logger.debug(`[SugarCache:${this.namespace}] Function params - ${JSON.stringify(params)}, cacheKeys - ${JSON.stringify(cacheKeys)}, invalid keys - ${JSON.stringify(invalidKeys)}`);
            throw new Error('[SugarCache] Keys passed to decorator do not match function params');
        }
    };
}
