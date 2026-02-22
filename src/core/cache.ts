export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size <= this.capacity) {
      return;
    }
    const oldestKey = this.map.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey);
    }
  }
}

export class HotLruCache<V> {
  private hot: { key: string; value: V } | undefined;
  private readonly lru: LruCache<V>;

  constructor(capacity: number) {
    this.lru = new LruCache<V>(capacity);
  }

  get(key: string): V | undefined {
    if (this.hot?.key === key) {
      return this.hot.value;
    }
    const cached = this.lru.get(key);
    if (cached !== undefined) {
      this.hot = { key, value: cached };
    }
    return cached;
  }

  set(key: string, value: V): void {
    this.lru.set(key, value);
    this.hot = { key, value };
  }
}
