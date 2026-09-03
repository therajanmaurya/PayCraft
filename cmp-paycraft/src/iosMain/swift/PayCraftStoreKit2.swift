//
//  PayCraftStoreKit2.swift
//  PayCraft — Phase 3 (E3) native iOS IAP client.
//
//  StoreKit2 is a Swift-only async/await framework with NO Objective-C surface, so Kotlin/Native
//  cannot cinterop it directly. This thin shim is the ONE place StoreKit2 (`Product`, `Transaction`,
//  `AppStore`) is called; it conforms to the Kotlin `StoreKit2Bridge` protocol (exported into the
//  shared KMP framework header) and is injected from the iOS app via
//  `paycraftStoreKit2BillingModule(bridge:)`. `StoreKit2NativeBillingClient` (Kotlin) consumes only
//  the protocol, keeping the reconciliation/restore code device-free and unit-testable. It is also
//  the one place `Storefront.current` (billing region) and `Product.displayPrice` (store-localized
//  price) are read for the paywall currency fix.
//
//  WIRING (consuming iOS app):
//    1. Add this file to the app's Xcode target (it needs the app's StoreKit entitlement).
//    2. Replace `import PayCraftShared` below with your shared-framework module name (the one that
//       exports the Kotlin `StoreKit2Bridge` protocol — e.g. `Shared`, `ComposeApp`, `PayCraft`).
//    3. At startup:  KoinKt.doInitKoinWith(module: PayCraftDIKt.paycraftStoreKit2BillingModule(
//                        bridge: PayCraftStoreKit2()))
//
//  Kotlin `suspend fun` exports as a Swift `…(…, completionHandler:)` method; each async StoreKit2
//  call is wrapped in a `Task` and the result handed back through the completion handler.
//
//  Requires iOS 15+ (StoreKit2 baseline). Set the module's iOS deployment target to 15.0 or higher.
//

import Foundation
import StoreKit

// Replace with your shared KMP framework's module name (the one exporting `StoreKit2Bridge`).
import PayCraftShared

@available(iOS 15.0, *)
@objcMembers
public final class PayCraftStoreKit2: NSObject, StoreKit2Bridge {

    /// Held for the process lifetime — see `startTransactionUpdates(listener:)`.
    private var updatesTask: Task<Void, Never>?

    public override init() { super.init() }

    deinit { updatesTask?.cancel() }

    // MARK: purchase(productId:) -> StoreKit2Outcome

    public func purchase(
        productId: String,
        appAccountToken: String?,
        completionHandler: @escaping (StoreKit2Outcome?, Error?) -> Void
    ) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    completionHandler(StoreKit2OutcomeFailed(message: "Product not found: \(productId)"), nil)
                    return
                }

                // Bind the transaction to the app user so the App Store Server Notification can be
                // attributed. StoreKit requires a UUID here; Kotlin derives a stable one from the
                // app-user id.
                var options: Set<Product.PurchaseOption> = []
                if let token = appAccountToken, let uuid = UUID(uuidString: token) {
                    options.insert(.appAccountToken(uuid))
                }

                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    let transaction = try self.checkVerified(verification)
                    // DELIBERATELY NOT finishing here. finish() removes the transaction from
                    // StoreKit's unfinished queue; if the server call that follows fails, the
                    // purchase would be unrecoverable and the customer would have paid for
                    // nothing. Kotlin calls finish(transactionId:) once the entitlement is
                    // recorded server-side, and anything still unfinished is re-delivered by
                    // Transaction.updates on the next launch.
                    completionHandler(
                        StoreKit2OutcomeSuccess(transaction: self.map(transaction, jws: verification.jwsRepresentation)),
                        nil
                    )
                case .userCancelled:
                    completionHandler(StoreKit2Outcome.Cancelled(), nil)
                case .pending:
                    // Ask to Buy awaiting a parent, or SCA in progress. NOT a failure — the
                    // approval arrives later on Transaction.updates.
                    completionHandler(StoreKit2Outcome.Pending(), nil)
                @unknown default:
                    completionHandler(StoreKit2OutcomeFailed(message: "Unknown StoreKit purchase result"), nil)
                }
            } catch {
                completionHandler(StoreKit2OutcomeFailed(message: "StoreKit purchase failed: \(error.localizedDescription)"), nil)
            }
        }
    }

    // MARK: startTransactionUpdates(listener:) — the listener Apple requires you to run

    /// Attaches `Transaction.updates` for the process lifetime.
    ///
    /// This is the ONLY delivery path for renewals, Ask-to-Buy approvals, family-sharing grants,
    /// refunds, revocations, and transactions interrupted mid-purchase. Without it the SDK sees
    /// only what completes inside a foreground `purchase()` call, and an unfinished transaction
    /// replays forever because nothing ever finishes it.
    public func startTransactionUpdates(listener: StoreKit2TransactionListener) {
        // Retained deliberately: this Task must outlive the call. Cancelling it would silently
        // stop all out-of-band purchase delivery.
        self.updatesTask = Task.detached { [weak self] in
            for await verification in Transaction.updates {
                guard let self = self else { return }
                guard let transaction = try? self.checkVerified(verification) else { continue }
                listener.onTransaction(
                    transaction: self.map(transaction, jws: verification.jwsRepresentation)
                )
            }
        }
    }

    // MARK: finish(transactionId:)

    /// Finishes the transaction — called from Kotlin ONLY after the server records the entitlement.
    public func finish(transactionId: String, completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task {
            for await verification in Transaction.unfinished {
                guard let transaction = try? self.checkVerified(verification) else { continue }
                if String(transaction.id) == transactionId {
                    await transaction.finish()
                    break
                }
            }
            completionHandler(KotlinUnit(), nil)
        }
    }

    // MARK: currentEntitlements() -> [StoreKit2Transaction]

    public func currentEntitlements(completionHandler: @escaping ([StoreKit2Transaction]?, Error?) -> Void) {
        Task {
            var out: [StoreKit2Transaction] = []
            for await verification in Transaction.currentEntitlements {
                guard let transaction = try? self.checkVerified(verification) else { continue }
                out.append(self.map(transaction, jws: verification.jwsRepresentation))
            }
            completionHandler(out, nil)
        }
    }

    // MARK: sync()  ->  AppStore.sync()

    public func sync(completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task {
            do {
                try await AppStore.sync()
                completionHandler(KotlinUnit(), nil)
            } catch {
                // A sync failure is non-fatal for restore (currentEntitlements still reads the local
                // receipt) — report the error so the caller can surface it if desired.
                completionHandler(nil, error)
            }
        }
    }

    // MARK: showManageSubscriptions()

    public func showManageSubscriptions(completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task { @MainActor in
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                completionHandler(KotlinUnit(), nil)
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                completionHandler(KotlinUnit(), nil)
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    // MARK: storefrontCountry() -> String?

    public func storefrontCountry(completionHandler: @escaping (String?, Error?) -> Void) {
        Task {
            // `Storefront.current` is async — it resolves the storefront the signed-in Apple ID
            // buys from (the true billing region), independent of the device UI locale.
            let storefront = await Storefront.current
            completionHandler(storefront?.countryCode, nil)
        }
    }

    // MARK: displayPrice(productId:) -> StoreKit2Price?

    public func displayPrice(productId: String, completionHandler: @escaping (StoreKit2Price?, Error?) -> Void) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    completionHandler(nil, nil)
                    return
                }
                // `price` is a Decimal in the storefront currency; scale to integer micro-units.
                let micros = NSDecimalNumber(decimal: product.price * Decimal(1_000_000)).int64Value
                completionHandler(
                    StoreKit2Price(
                        formatted: product.displayPrice,
                        currencyCode: product.priceFormatStyle.currencyCode,
                        amountMicros: micros
                    ),
                    nil
                )
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    // MARK: - Helpers

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    private func map(_ transaction: Transaction, jws: String) -> StoreKit2Transaction {
        StoreKit2Transaction(
            productId: transaction.productID,
            jwsRepresentation: jws,
            originalId: String(transaction.originalID),
            purchaseDateMillis: Int64(transaction.purchaseDate.timeIntervalSince1970 * 1000.0),
            // NOTE: productType == .autoRenewable reports what KIND of product this is, not
            // whether renewal is switched on — a cancelled-but-still-active subscription reports
            // true here. The real value comes from SubscriptionInfo.RenewalInfo.willAutoRenew and
            // is corrected in Phase 3; keeping the shape stable until then.
            isAutoRenewing: transaction.productType == .autoRenewable,
            transactionId: String(transaction.id),
            isUnfinished: true
        )
    }
}
