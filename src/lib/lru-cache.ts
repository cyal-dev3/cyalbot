/**
 * Simple LRU Cache Implementation
 * Limita el tamaño del cache eliminando elementos menos usados
 */

export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Obtiene un valor del cache
   * Mueve el elemento al final (más reciente)
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Mover al final (más reciente)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Agrega o actualiza un valor en el cache
   * Elimina el elemento más antiguo si excede el tamaño
   */
  set(key: K, value: V): void {
    // Si ya existe, eliminarlo para actualizar posición
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Eliminar el más antiguo si excede tamaño
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Verifica si existe una clave
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Elimina un elemento del cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Limpia todo el cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Retorna el tamaño actual del cache
   */
  get size(): number {
    return this.cache.size;
  }
}
