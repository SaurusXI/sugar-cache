# sugar-cache
Cache library for Node.js built on top of ioredis. 

## Usage
SugarCache exports a default class that instantiates a cache for you when constructed -
```javascript
import { SugarCache } from 'sugar-cache';
import Redis from 'ioredis';

const redisObj = new Redis();
const cache = new SugarCache(redisObj, { width: 1000 });
```

The cache creation options are -
- `width`: The maximum number of elements that the cache can hold. This option is required
- `namespace`: The namespace for your cache. If namespace is not specified all values are cached under the same default namespace as other instances of the cache. This option allows you to create multiple caches isolated from each other, which is recommended if you're instantiating multiple cache objects.
- `ttl`: Time-to-live for cache entries in milliseconds.

### Interface
The cache object provides some base API methods -
- `set` -
Adds a value to cache.
```javascript
await cache.set(key, value);
```

- `get` -
Reads a value from cache.
```javascript
const cachedVal = await cache.get(key);
```

- `del` - 
Deletes a key value pair from cache.
```javascript
await cache.del(key);
```

- `clear` -
Delete all values under the namespace of the cache.
```javascript
await cache.clear();
```

### Decorator methods
`SugarCache` provides some decorator methods for easier usage.  instead of invoking the function again. You can use the `getOrSet` method for this.
- `getOrSet` -  
Say you need to set cache on the results of a function invocation so that the next time the function is invoked with some subset of its arguments, you get the result from cache.
```typescript
@cache.getOrSet(['resourceId', 'parentResourceId'])
async readResource(resourceId: string, parentResourceId: string, ...rest) { ... }
```
- `invalidate`
For when you need to invalidate a resource from cache. For instance, for the `readResource` function above, if we wish to delete the resource from cache whenever its changed from another function -
```typescript
@cache.invalidate(['resourceId', 'parentResourceId'])
async editResource(resourceId: string, parentResourceId: string, logger, ...rest) { ... }
```
## Contributors
- [Shantanu Verma](https://github.com/SaurusXI)

## License
[GPL-v3](https://www.gnu.org/licenses/gpl-3.0.en.html)
