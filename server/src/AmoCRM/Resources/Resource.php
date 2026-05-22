<?php

declare(strict_types=1);

namespace DealDist\AmoCRM\Resources;

use DealDist\AmoCRM\Connector;

abstract class Resource
{
    public function __construct(
        protected readonly Connector $connector,
        protected readonly string    $accountId,
    ) {
    }

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    protected function request(string $method, string $path, array $options = []): array
    {
        return $this->connector->request($this->accountId, $method, $path, $options);
    }

    /**
     * Build a query string from a structured params array.
     *
     * Supported keys:
     *   - 'with'   array<string>        => with=a,b,c
     *   - 'filter' array<string,mixed>  => filter[k]=v   or  filter[k][i]=v for arrays
     *   - 'order'  array<string,string> => order[field]=asc|desc
     *   - any other scalar key          => key=value
     */
    protected function buildQuery(array $params): string
    {
        if ($params === []) {
            return '';
        }

        $flat = [];
        foreach ($params as $key => $value) {
            if ($key === 'with' && is_array($value)) {
                $flat['with'] = implode(',', $value);
                continue;
            }
            if (($key === 'filter' || $key === 'order') && is_array($value)) {
                foreach ($value as $subKey => $subValue) {
                    if (is_array($subValue)) {
                        foreach (array_values($subValue) as $i => $item) {
                            $flat["{$key}[{$subKey}][{$i}]"] = $item;
                        }
                    } else {
                        $flat["{$key}[{$subKey}]"] = $subValue;
                    }
                }
                continue;
            }
            $flat[$key] = $value;
        }

        return '?' . http_build_query($flat);
    }

    /**
     * Walk a paginated list endpoint, yielding embedded items page by page.
     *
     * @param string $embeddedKey  Key under `_embedded` (e.g. "leads", "contacts")
     * @return iterable<array<string,mixed>>
     */
    protected function paginate(string $path, string $embeddedKey, array $params = []): iterable
    {
        $params['limit'] = $params['limit'] ?? 250;
        $params['page']  = $params['page']  ?? 1;

        while (true) {
            $query = $this->buildQuery($params);
            $page  = $this->request('GET', $path . $query);
            $items = $page['_embedded'][$embeddedKey] ?? [];

            foreach ($items as $item) {
                yield $item;
            }

            $hasNext = !empty($page['_links']['next']['href']);
            if (!$hasNext || count($items) < (int) $params['limit']) {
                break;
            }
            $params['page'] = (int) $params['page'] + 1;
        }
    }
}
