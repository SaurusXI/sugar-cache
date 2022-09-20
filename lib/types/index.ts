import { EvictionScheme } from "../constants";

export type CacheOptions = {
    ttl?: number;
    namespace?: string;
    scheme?: EvictionScheme;
    width: number;
}
