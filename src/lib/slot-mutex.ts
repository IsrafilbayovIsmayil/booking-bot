/**
 * Мьютекс по ключу слота: сериализует конкурентные запросы на ОДНО и то же
 * время внутри одного экземпляра приложения (warm serverless instance /
 * long-running node). Это первый рубеж защиты от двойного бронирования;
 * межинстансные гонки закрывает верификация после insert в route-обработчике
 * (см. resolveInsertRaceWinner в google-calendar.ts).
 */

const chains = new Map<string, Promise<void>>();

export async function withSlotLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();

  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  chains.set(
    key,
    previous.then(() => current),
  );

  await previous;
  try {
    return await task();
  } finally {
    release();
    // Не даём Map расти бесконечно: если никто не встал в очередь после нас,
    // убираем ключ.
    void current.then(() => {
      if (chains.get(key) === current) {
        chains.delete(key);
      }
    });
  }
}
