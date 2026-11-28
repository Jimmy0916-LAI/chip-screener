"""Bounded in-process cache for market responses."""

import threading
import time
from collections import OrderedDict


class MarketCache:
    def __init__(self, capacity=48, clock=time.monotonic):
        self.capacity = capacity
        self.clock = clock
        self._entries = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key, ttl=None):
        with self._lock:
            cached = self._entries.get(key)
            if cached is None or (ttl is not None and self.clock() - cached[0] >= ttl):
                return None
            self._entries.move_to_end(key)
            return cached[1]

    def put(self, key, value):
        with self._lock:
            self._entries[key] = (self.clock(), value)
            self._entries.move_to_end(key)
            while len(self._entries) > self.capacity:
                self._entries.popitem(last=False)

    def discard(self, key):
        with self._lock:
            self._entries.pop(key, None)

    def items(self):
        with self._lock:
            return {key: value for key, (_, value) in self._entries.items()}

    def clear(self):
        with self._lock:
            self._entries.clear()
