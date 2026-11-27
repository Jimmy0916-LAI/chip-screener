"""Bounded background workers that cannot outlive the desktop process."""
from concurrent.futures import Future
from queue import Queue
from threading import Event, Thread

closing = Event()


class CrawlerPool:
    def __init__(self, max_workers):
        self.queue = Queue()
        self.workers = [Thread(target=self._work, daemon=True) for _ in range(max_workers)]
        for worker in self.workers:
            worker.start()

    def _work(self):
        while (job := self.queue.get()) is not None:
            future, fn, args = job
            if not future.set_running_or_notify_cancel():
                continue
            try:
                if closing.is_set():
                    raise InterruptedError('籌碼雷達視窗已關閉')
                future.set_result(fn(*args))
            except BaseException as exc:
                future.set_exception(exc)

    def submit(self, fn, *args):
        future = Future()
        self.queue.put((future, fn, args))
        return future

    def map(self, fn, values):
        futures = [self.submit(fn, value) for value in values]
        return (future.result() for future in futures)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        for worker in self.workers:
            self.queue.put(None)
        for worker in self.workers:
            worker.join()
