-- 0060_metric_notifications: расширяем типы уведомлений значениями для модуля
-- «Показатели»: metric_missing (не заполнен факт за закрытый период) и
-- metric_below_plan (факт хуже плана). Меняем CHECK-ограничение на notifications.type.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'cash_gap','debt_overdue','budget_over','transfer_short','training_due',
    'metric_missing','metric_below_plan'
  ));
