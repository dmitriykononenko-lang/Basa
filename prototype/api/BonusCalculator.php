<?php
declare(strict_types=1);

/**
 * Расчёт бонуса аналитика по проекту.
 *
 * Правила:
 *  - Если у проекта задан custom_bonus — используется он.
 *  - Иначе:
 *      rate_type = 'percent'  →  бонус = budget * rate_value / 100
 *      rate_type = 'fixed'    →  бонус = rate_value
 *  - Отменённые проекты возвращают 0.
 */
final class BonusCalculator
{
    public static function calculate(array $project, array $analyst): float
    {
        $status = $project['status'] ?? 'launched';
        if ($status === 'cancelled') {
            return 0.0;
        }

        if (isset($project['custom_bonus']) && $project['custom_bonus'] !== null) {
            return round((float)$project['custom_bonus'], 2);
        }

        $rateType = $analyst['rate_type'] ?? 'percent';
        $rateValue = (float)($analyst['rate_value'] ?? 0);
        $budget = (float)($project['budget'] ?? 0);

        if ($rateType === 'fixed') {
            return round($rateValue, 2);
        }

        return round($budget * $rateValue / 100, 2);
    }
}
