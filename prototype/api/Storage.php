<?php
declare(strict_types=1);

/**
 * Простое JSON-файловое хранилище коллекции записей с id.
 */
final class Storage
{
    private string $file;

    public function __construct(string $file)
    {
        $this->file = $file;
        $dir = dirname($file);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        if (!file_exists($file)) {
            file_put_contents($file, "[]\n");
        }
    }

    public function all(): array
    {
        $fp = fopen($this->file, 'r');
        if ($fp === false) {
            return [];
        }
        flock($fp, LOCK_SH);
        $raw = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        $data = json_decode($raw ?: '[]', true);
        return is_array($data) ? $data : [];
    }

    public function find(string $id): ?array
    {
        foreach ($this->all() as $item) {
            if (($item['id'] ?? null) === $id) {
                return $item;
            }
        }
        return null;
    }

    public function upsert(array $item): void
    {
        $this->mutate(function (array $items) use ($item): array {
            $found = false;
            foreach ($items as &$existing) {
                if (($existing['id'] ?? null) === ($item['id'] ?? null)) {
                    $existing = $item;
                    $found = true;
                    break;
                }
            }
            unset($existing);
            if (!$found) {
                $items[] = $item;
            }
            return $items;
        });
    }

    public function delete(string $id): void
    {
        $this->mutate(static function (array $items) use ($id): array {
            return array_values(array_filter(
                $items,
                static fn(array $i) => ($i['id'] ?? null) !== $id
            ));
        });
    }

    private function mutate(callable $fn): void
    {
        $fp = fopen($this->file, 'c+');
        if ($fp === false) {
            throw new RuntimeException('Не удалось открыть файл хранилища: ' . $this->file);
        }
        flock($fp, LOCK_EX);
        rewind($fp);
        $raw = stream_get_contents($fp);
        $items = json_decode($raw ?: '[]', true);
        if (!is_array($items)) {
            $items = [];
        }
        $items = $fn($items);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($items, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}
