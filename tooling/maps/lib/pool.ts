/**
 * Пул задач с ограниченной параллельностью. Источник может быть асинхронным генератором:
 * тогда следующий элемент вычисляется, пока остальные работники заняты, — так в памяти
 * одновременно живёт не больше `limit` элементов.
 */
export async function runPool<T>(
  items: Iterable<T> | AsyncIterable<T>,
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const iterator: Iterator<T> | AsyncIterator<T> = isAsyncIterable(items)
    ? items[Symbol.asyncIterator]()
    : items[Symbol.iterator]();
  const state: { failure?: { error: unknown } } = {};

  async function worker(): Promise<void> {
    while (!state.failure) {
      let next: IteratorResult<T>;
      try {
        next = await iterator.next();
      } catch (error) {
        state.failure ??= { error };
        return;
      }
      if (next.done) return;
      try {
        await task(next.value);
      } catch (error) {
        state.failure ??= { error };
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.floor(limit)) }, () => worker()));
  if (state.failure) {
    // Генератор мог остаться посреди работы — закрываем его, чтобы освободить ресурсы.
    await iterator.return?.();
    throw state.failure.error;
  }
}

function isAsyncIterable<T>(items: Iterable<T> | AsyncIterable<T>): items is AsyncIterable<T> {
  return typeof (items as Partial<AsyncIterable<T>>)[Symbol.asyncIterator] === 'function';
}
