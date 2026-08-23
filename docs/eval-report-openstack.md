# Rule-Engine Evaluation Report — 2026-08-22T13:47:33.271Z

=== Rule-engine evaluation: data\loghub ===
(line-level ground truth: lines mentioning an anomalous VM instance)
(metrics apply to the *abnormal* file only — OpenStack convention;
 normal files may mention the same instances without being anomalous)

## openstack_abnormal.log

- lines: 18435 | rule-flagged: 383 (2.08%) | baseline-flagged: 0 (0.00%) | time: 87 ms
- top rules: http-error×369, authentication×14

| detector | precision | recall | F1 | accuracy | TP/FP/FN/TN | flagged | positives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| engine | 0.003 | 0.009 | 0.004 | 0.973 | 1/382/111/17941 | 383 | 112 |
| baseline | — | 0.000 | — | 0.994 | 0/0/112/18323 | 0 | 112 |

## openstack_normal1.log

- lines: 52313 | rule-flagged: 1124 (2.15%) | baseline-flagged: 26 (0.05%) | time: 234 ms
- top rules: http-error×1073, authentication×51, file-not-found×1

## openstack_normal2.log

- lines: 137075 | rule-flagged: 2675 (1.95%) | baseline-flagged: 170 (0.12%) | time: 567 ms
- top rules: http-error×2529, authentication×142, file-not-found×7

## Caveats

- The rule engine is tuned for crash/exception-style application logs; datasets that inject behavioural anomalies without ERROR keywords (e.g. OpenStack VM failures) will show near-zero recall — an honest domain-mismatch measurement, not a bug.
- Label granularity differs per dataset: OpenStack labels are per VM instance (mapped to lines mentioning those instances); Hadoop labels are per application (here every line of the failing apps counts as positive, which dilutes recall). Prefer the flagged-rate ratio (abnormal vs normal) over raw recall for app-level labels.
- The benchmark scans every line with no per-rule evidence cap (the UI engine caps display evidence at 8 lines/rule).
