<?php

declare(strict_types=1);

namespace DealDist\Tests\Unit\AmoCRM;

use DealDist\AmoCRM\AmoCrmException;
use DealDist\AmoCRM\FileTokenStorage;
use PHPUnit\Framework\TestCase;

/** @covers \DealDist\AmoCRM\FileTokenStorage */
final class FileTokenStorageTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/amocrm_storage_' . uniqid('', true);
    }

    protected function tearDown(): void
    {
        if (is_dir($this->dir)) {
            foreach (glob($this->dir . '/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
    }

    public function testSaveAndLoadRoundtrip(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $data    = ['access_token' => 'a', 'refresh_token' => 'r', 'base_domain' => 'x.amocrm.ru', 'expires_at' => 123];

        $storage->save('42', $data);

        $this->assertSame($data, $storage->load('42'));
    }

    public function testLoadReturnsNullForUnknownAccount(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $this->assertNull($storage->load('unknown'));
    }

    public function testDelete(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $storage->save('42', ['access_token' => 'a', 'refresh_token' => 'r', 'base_domain' => 'x.amocrm.ru']);
        $storage->delete('42');

        $this->assertNull($storage->load('42'));
    }

    public function testDeleteIsIdempotent(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $storage->delete('does-not-exist');
        $this->assertNull($storage->load('does-not-exist'));
    }

    public function testAccountIdsAreSanitizedToPreventTraversal(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $storage->save('../../etc/passwd', ['access_token' => 'a', 'refresh_token' => 'r', 'base_domain' => 'x.amocrm.ru']);

        // File should land inside $this->dir, not outside
        $files = glob($this->dir . '/*.json') ?: [];
        $this->assertCount(1, $files);
        $this->assertStringStartsWith($this->dir . '/', $files[0]);
    }

    public function testEmptyAccountIdRejected(): void
    {
        $storage = new FileTokenStorage($this->dir);
        $this->expectException(AmoCrmException::class);
        $storage->save('', ['access_token' => 'a', 'refresh_token' => 'r', 'base_domain' => 'x.amocrm.ru']);
    }
}
