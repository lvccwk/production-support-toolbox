# Rule-Engine Evaluation Report — 2026-08-22T13:47:11.621Z

=== Rule-engine evaluation: data\hadoop_eval ===
(file-level ground truth (--label-all): every line of the *abnormal* file counts as positive —
 application-level labels such as Hadoop's machine-down / disk-full / network-disconnect)

## hadoop_abnormal.log

- lines: 368886 | rule-flagged: 10960 (2.97%) | baseline-flagged: 613 (0.17%) | time: 816 ms
- top rules: connection-failure×10700, timeout×5359, authentication×176, dns×48, permission×16

| detector | precision | recall | F1 | accuracy | TP/FP/FN/TN | flagged | positives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| engine | 1.000 | 0.030 | 0.058 | 0.030 | 10960/0/357926/0 | 10960 | 368886 |
| baseline | 1.000 | 0.002 | 0.003 | 0.002 | 613/0/368273/0 | 613 | 368886 |

## hadoop_normal.log

- lines: 25426 | rule-flagged: 34 (0.13%) | baseline-flagged: 12 (0.05%) | time: 71 ms
- top rules: authentication×25, timeout×6, connection-failure×3

## Caveats

- The rule engine is tuned for crash/exception-style application logs; infrastructure datasets (OpenStack) inject behavioural anomalies that may not carry ERROR keywords — low recall is expected and informative, not a bug.
- Label granularity matters: OpenStack labels are per VM instance; we map them to lines mentioning those instances (a conservative approximation).
