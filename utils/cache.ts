/**
 * Performance optimization utilities for caching and pooling
 */

import { ModelEntry } from '../types.js';

/**
 * LRU Cache implementation for model metadata
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private accessOrder: K[] = [];
  
  constructor(
    private maxSize: number,
    private ttlMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {}
  
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    
    // Update access order
    this.updateAccessOrder(key);
    return entry.value;
  }
  
  set(key: K, value: V): void {
    // Evict if at capacity
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    
    this.cache.set(key, { value, timestamp: Date.now() });
    this.updateAccessOrder(key);
  }
  
  delete(key: K): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
    return deleted;
  }
  
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
  
  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
  
  private evictLRU(): void {
    const lru = this.accessOrder.shift();
    if (lru !== undefined) {
      this.cache.delete(lru);
    }
  }
}

/**
 * Model metadata cache
 */
class ModelMetadataCache {
  private cache = new LRUCache<string, ModelEntry>(100, 10 * 60 * 1000); // 10 min TTL
  
  get(modelId: string): ModelEntry | undefined {
    return this.cache.get(modelId);
  }
  
  set(modelId: string, entry: ModelEntry): void {
    this.cache.set(modelId, entry);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// Global instance
export const modelMetadataCache = new ModelMetadataCache();

/**
 * Connection pool for HTTP clients
 */
export class ConnectionPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  private waitQueue: Array<(conn: T) => void> = [];
  
  constructor(
    private factory: () => T,
    private maxConnections: number = 10
  ) {
    // Pre-create some connections
    for (let i = 0; i < Math.min(3, maxConnections); i++) {
      this.available.push(this.factory());
    }
  }
  
  async acquire(): Promise<T> {
    // Return available connection
    const conn = this.available.pop();
    if (conn) {
      this.inUse.add(conn);
      return conn;
    }
    
    // Create new if under limit
    if (this.inUse.size < this.maxConnections) {
      const newConn = this.factory();
      this.inUse.add(newConn);
      return newConn;
    }
    
    // Wait for available connection
    return new Promise<T>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }
  
  release(conn: T): void {
    this.inUse.delete(conn);
    
    // Fulfill waiting request
    const waiter = this.waitQueue.shift();
    if (waiter) {
      this.inUse.add(conn);
      waiter(conn);
    } else {
      this.available.push(conn);
    }
  }
  
  async withConnection<R>(fn: (conn: T) => Promise<R>): Promise<R> {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }
  
  destroy(): void {
    this.available = [];
    this.inUse.clear();
    this.waitQueue = [];
  }
}

/**
 * Request deduplication
 */
export class RequestDeduplicator<K, V> {
  private pending = new Map<K, Promise<V>>();
  
  async deduplicate(
    key: K,
    factory: () => Promise<V>
  ): Promise<V> {
    // Return existing promise if request is in flight
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }
    
    // Create new promise and track it
    const promise = factory().finally(() => {
      this.pending.delete(key);
    });
    
    this.pending.set(key, promise);
    return promise;
  }
  
  clear(): void {
    this.pending.clear();
  }
}

/**
 * Token bucket for rate limiting
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
    private initialTokens?: number
  ) {
    this.tokens = initialTokens ?? capacity;
    this.lastRefill = Date.now();
  }
  
  async consume(count: number = 1): Promise<boolean> {
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    
    return false;
  }
  
  async waitAndConsume(count: number = 1): Promise<void> {
    while (true) {
      if (await this.consume(count)) {
        return;
      }
      
      // Calculate wait time
      const tokensNeeded = count - this.tokens;
      const waitMs = (tokensNeeded / this.refillRate) * 1000;
      
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 100)));
    }
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Response cache for identical requests
 */
export class ResponseCache {
  private cache = new LRUCache<string, any>(50, 60 * 1000); // 1 min TTL
  
  generateKey(
    model: string,
    messages: any[],
    options?: any
  ): string {
    const data = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      })),
      temperature: options?.temperature,
      max_tokens: options?.max_tokens
    };
    
    return JSON.stringify(data);
  }
  
  get(key: string): any | undefined {
    return this.cache.get(key);
  }
  
  set(key: string, value: any): void {
    this.cache.set(key, value);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// Global instances
export const responseCache = new ResponseCache();
export const requestDeduplicator = new RequestDeduplicator<string, any>();