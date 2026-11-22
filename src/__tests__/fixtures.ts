// Sample payloads copied from the gateways' documentation (see docs/SOURCES.md),
// trimmed to the fields the normalisers read plus a few neighbours.

/** Razorpay docs, "Payment Captured", Netbanking sample. */
export const razorpayPaymentCaptured = `{
  "entity": "event",
  "account_id": "acc_BFQ7uQEaa7j2z7",
  "event": "payment.captured",
  "contains": ["payment"],
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_DESlfW9H8K9uqM",
        "entity": "payment",
        "amount": 100,
        "currency": "INR",
        "base_amount": 100,
        "status": "captured",
        "order_id": "order_DESlLckIVRkHWj",
        "method": "netbanking",
        "captured": true,
        "bank": "HDFC",
        "created_at": 1567674599
      }
    }
  },
  "created_at": 1567674606
}`;

/** Razorpay docs, "Refund Processed" sample. */
export const razorpayRefundProcessed = `{
  "entity": "event",
  "account_id": "acc_E7OQJcEANmBHTC",
  "event": "refund.processed",
  "contains": ["refund", "payment"],
  "payload": {
    "refund": {
      "entity": {
        "id": "rfnd_FS8TWyPrCsa0OB",
        "entity": "refund",
        "amount": 50000,
        "currency": "INR",
        "payment_id": "pay_FPoJKWQQ8lK13n",
        "created_at": 1597734071,
        "status": "processed"
      }
    },
    "payment": {
      "entity": {
        "id": "pay_FPoJKWQQ8lK13n",
        "entity": "payment",
        "amount": 500000,
        "currency": "INR",
        "status": "captured",
        "order_id": "order_FPoIeimWki9j8A",
        "method": "netbanking",
        "created_at": 1597226379
      }
    }
  },
  "created_at": 1597734071
}`;

/** Cashfree docs, "Payment failed webhook", version 2025-01-01 (amount 1.8 rupees). */
export const cashfreePaymentFailed = `{
"data": {
    "order": {
        "order_id": "CFPay_g47u3888d0k0_tblfm766qc",
        "order_amount": 1.8,
        "order_currency": "INR"
    },
    "payment": {
        "cf_payment_id": "1504280029",
        "payment_status": "FAILED",
        "payment_amount": 1.8,
        "payment_currency": "INR",
        "payment_message": "AMOUNT SHOULD BE WITHIN RANGE BETWEEN 20.00 TO 500000.00.",
        "payment_time": "2023-01-06T20:00:11+05:30",
        "payment_group": "net_banking"
    }
},
"event_time": "2023-08-01T20:00:12+05:30",
"type": "PAYMENT_FAILED_WEBHOOK"
}`;

/** Cashfree docs, "Payment charges webhook" uses `6.00`; the same form for a success event. */
export const cashfreePaymentSuccess = `{"data":{"order":{"order_id":"14508_73_1783668483731","order_amount":6.00,"order_currency":"INR","order_tags":null},"payment":{"cf_payment_id":5979305158,"payment_status":"SUCCESS","payment_amount":6.00,"payment_currency":"INR","payment_message":"SUCCESS","payment_time":"2026-07-10T12:58:04+05:30","bank_reference":"841754751916","auth_id":null,"payment_method":{},"payment_group":"sbc_upi"}},"event_time":"2026-07-15T08:00:05+05:30","type":"PAYMENT_SUCCESS_WEBHOOK"}`;

/** Cashfree docs, "Refund webhook payload", version 2023-08-01. */
export const cashfreeRefund = `{
"data":{
    "refund":{
         "cf_refund_id":11325632,
         "cf_payment_id":789727431,
         "refund_id":"refund_sampleorder0413",
         "order_id":"sampleorder0413",
         "refund_amount":2.00,
         "refund_currency":"INR",
         "entity":"Refund",
         "refund_type":"MERCHANT_INITIATED",
         "refund_status":"SUCCESS",
         "processed_at":"2022-02-28T13:04:27+05:30"
    }
   },
   "event_time":"2022-02-28T13:04:28+05:30",
   "type":"REFUND_STATUS_WEBHOOK"
}`;

/** PhonePe docs, "Response for Order Completed". */
export const phonepeOrderCompleted = `{
    "event": "checkout.order.completed",
    "payload": {
        "orderId": "OMO2403282020198641071317",
        "merchantId": "merchantId",
        "merchantOrderId": "merchantOrderId",
        "state": "COMPLETED",
        "amount": 10000,
        "expireAt": 1724866793837,
        "paymentDetails": [
            {
                "paymentMode": "UPI_QR",
                "transactionId": "OM12334",
                "timestamp": 1724866793837,
                "amount": 10000,
                "state": "COMPLETED"
            }
        ]
    }
}`;

/** PhonePe docs, "Response for Refund Completed", case 2. */
export const phonepeRefundCompleted = `{
    "event": "pg.refund.completed",
    "payload": {
        "merchantId": "merchantId",
        "merchantRefundId": "merchantRefundId",
        "originalMerchantOrderId": "Refund-12345",
        "amount": 50000,
        "state": "COMPLETED",
        "timestamp": 1730869961754,
        "refundId": "OMR7878098045517540996"
    }
}`;

/** Juspay docs, ORDER_SUCCEEDED sample (trimmed). */
export const juspayOrderSucceeded = `{
  "id": "evt_V2_b737837102414514ae0e9717a9f2664d",
  "event_name": "ORDER_SUCCEEDED",
  "date_created": "2023-08-10T07:00:48Z",
  "content": {
    "order": {
      "txn_id": "ms-sample_ord_200-1",
      "payment_method": "VISA",
      "txn_uuid": "moziqFZtYKQkTsRFGXX",
      "status": "CHARGED",
      "id": "ordeh_a9eb2884e4fe4738b70c3d51e6397d34",
      "order_id": "sample_ord_200",
      "currency": "INR",
      "txn_detail": { "txn_id": "ms-sample_ord_200-1", "txn_amount": 1, "txn_uuid": "moziqFZtYKQkTsRFGXX", "status": "CHARGED" },
      "payment_method_type": "CARD",
      "amount": 1,
      "refunded": false
    }
  }
}`;

/** Juspay docs, ORDER_REFUNDED sample (trimmed). */
export const juspayOrderRefunded = `{
  "id": "evt_V2_132b474fe46b4518a561ad1aa18b4e42",
  "event_name": "ORDER_REFUNDED",
  "date_created": "2023-08-10T07:49:01Z",
  "content": {
    "order": {
      "txn_id": "ms-sample_ord_403-1",
      "txn_uuid": "moz3AaBzkvLbgPY99xi",
      "amount_refunded": 5,
      "status": "CHARGED",
      "id": "ordeh_11772e318c124b96ab9791ec3f6b13f8",
      "order_id": "sample_ord_403",
      "currency": "INR",
      "payment_method_type": "CARD",
      "amount": 8,
      "refunds": [
        {
          "unique_request_id": "erf_b0c764a743c4221b",
          "created": "2023-08-10T07:22:01Z",
          "status": "SUCCESS",
          "id": null,
          "amount": 5
        }
      ]
    }
  }
}`;

/** PayU docs, "Payment Successful" sample fields (hash removed; tests sign with their own salt). */
export const payuSuccessFields: Record<string, string> = {
  mihpayid: '27553369917',
  mode: 'SBQR',
  status: 'success',
  key: 'rZ1fX4',
  txnid: 'T2603041446091822117753',
  amount: '40.00',
  addedon: '2026-03-04 14:46:14',
  productinfo: 'Static QR',
  firstname: '',
  email: '',
  udf1: '',
  udf2: '',
  udf3: '',
  udf4: 'SoftQR',
  udf5: 'BFL0000006601446',
  unmappedstatus: 'captured',
  bank_ref_num: '793887773815',
};

/** PayU docs, "Refund Successful" JSON sample. */
export const payuRefundJson = `{
  "additionalValue1": null,
  "bank_arn": null,
  "refund_mode": "Instant Credit through UPI",
  "bank_ref_num": "100142082006",
  "key": "IahMJL",
  "amt": "72.00",
  "remark": null,
  "status": "success",
  "token": "PZT2506150013OR4AN33",
  "mihpayid": " 23907365951 ",
  "request_id": "17265314530",
  "merchantTxnId": "PZT2506150013OR4AN02",
  "additionalValue2": null,
  "action": "refund"
}`;
