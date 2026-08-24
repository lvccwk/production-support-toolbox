/**
 * 試玩用嘅示範 log — 完全虛構,唔含任何真實客戶數據。
 * 專登設計成會命中內建規則(NullPointerException / PaymentService),
 * 所以一撳「30 秒試玩」即刻有結果,唔使等 AI fallback。
 */
export const SAMPLE_CRASH_LOG = `2024-11-12 10:23:45.123 ERROR [http-nio-8080-exec-7] com.example.payment.PaymentService - NullPointerException processing payment order=PO-88421
	at com.example.payment.PaymentService.authorize(PaymentService.java:142)
	at com.example.payment.PaymentController.createOrder(PaymentController.java:58)
	at java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
Caused by: java.lang.IllegalStateException: Missing customer account for reference=acc-33102
	at com.example.payment.CustomerService.findById(CustomerService.java:31)
	at com.example.payment.PaymentService.authorize(PaymentService.java:138)
2024-11-12 10:23:45.900 WARN  [http-nio-8080-exec-7] com.example.payment.PaymentController - Retrying after error, attempt 1/3
2024-11-12 10:23:52.412 ERROR [http-nio-8080-exec-9] com.example.payment.PaymentService - NullPointerException processing payment order=PO-88422
	at com.example.payment.PaymentService.authorize(PaymentService.java:142)
	at com.example.payment.PaymentController.createOrder(PaymentController.java:58)
2024-11-12 10:23:55.001 ERROR [scheduling-1] com.example.order.OrderSyncJob - Sync failed: connection timeout to https://payments.example.com after 30000ms
	at com.example.order.OrderSyncJob.run(OrderSyncJob.java:77)
2024-11-12 10:24:01.330 INFO  [http-nio-8080-exec-7] com.example.payment.PaymentService - authorize ok order=PO-88421 attempts=2`;