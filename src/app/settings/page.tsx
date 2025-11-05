"use client";

import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, CreditCard, Zap, Check, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

function SettingsContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(1000);
  const [planType, setPlanType] = useState("FREE");
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [stripePublicKey, setStripePublicKey] = useState<string | null>(null);

  const fetchUserData = useCallback(async () => {
    try {
      const response = await fetch("/api/files/credits");
      if (response.ok) {
        const data = await response.json();
        setCredits(data.credits || 1000);
        setPlanType(data.planType || "FREE");
        // Check if user has a subscription
        setHasSubscription(data.hasSubscription || false);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStripeConfig = async () => {
    try {
      const response = await fetch("/api/stripe/config");
      if (response.ok) {
        const data = await response.json();
        setStripePublicKey(data.publicKey || null);
      }
    } catch (error) {
      console.error("Error fetching Stripe config:", error);
    }
  };

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/signin");
      return;
    }

    // Check for success/cancel messages from Stripe redirect
    const success = searchParams.get("success");
    const canceled = searchParams.get("canceled");

    if (success) {
      toast.success(
        "Subscription activated successfully! Credits have been added to your account."
      );
      // Clean URL
      router.replace("/settings");
    }

    if (canceled) {
      toast.error("Checkout was canceled.");
      router.replace("/settings");
    }

    // Fetch user data after handling redirects to ensure subscription status is updated
    fetchUserData();
    fetchStripeConfig();
  }, [session, status, router, searchParams, fetchUserData]);

  // Refetch user data when success parameter is present to get updated subscription status
  useEffect(() => {
    const success = searchParams.get("success");
    if (success) {
      // Small delay to allow webhook to process
      const timer = setTimeout(() => {
        fetchUserData();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, fetchUserData]);

  const handleSubscribe = async (planType: "BASIC" | "PRO") => {
    if (!stripePublicKey) {
      toast.error(
        "Stripe is not configured. Please add STRIPE_PUBLIC_KEY to your environment variables and redeploy.",
        { duration: 6000 }
      );
      console.error(
        "STRIPE_PUBLIC_KEY is missing. Please add it to Vercel environment variables."
      );
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planType }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get checkout URL");
      }
    } catch (error: unknown) {
      console.error("Checkout error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start checkout";
      toast.error(errorMessage);
      setIsProcessing(false);
    }
  };

  const handleManageBilling = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create portal session");
      }

      // Redirect to Stripe Customer Portal
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: unknown) {
      console.error("Portal error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to open billing portal";
      toast.error(errorMessage);
      setIsProcessing(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navigation currentPage="settings" />

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">
              Settings
            </h1>
            <p className="text-muted-foreground">
              Manage your subscription and account settings
            </p>
          </div>

          {/* Current Plan & Credits */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Account Overview
              </CardTitle>
              <CardDescription>
                Your current plan and credit balance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Current Plan */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    Current Plan
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        planType === "PRO"
                          ? "bg-purple-900 text-purple-300 border-purple-700"
                          : planType === "BASIC"
                          ? "bg-blue-900 text-blue-300 border-blue-700"
                          : "bg-gray-700 text-gray-300 border-gray-600"
                      }
                    >
                      {planType}
                    </Badge>
                  </div>
                </div>

                {/* Credits */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    Credits Remaining
                  </p>
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    <span className="text-2xl font-bold text-foreground">
                      {credits.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Credit Info */}
              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Credit System:</strong>{" "}
                  Each PDF extraction costs <strong>100 credits</strong>. You
                  currently have{" "}
                  <strong>{credits.toLocaleString()} credits</strong> remaining,
                  which allows for approximately{" "}
                  <strong>{Math.floor(credits / 100)} more extractions</strong>.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Subscription Plans */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription Plans
              </CardTitle>
              <CardDescription>
                Choose a plan that fits your needs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Basic Plan */}
                <Card className="border-2">
                  <CardHeader>
                    <CardTitle>Basic Plan</CardTitle>
                    <CardDescription>$10/month</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>10,000 credits included</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>~100 PDF extractions</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>Monthly subscription</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleSubscribe("BASIC")}
                      disabled={isProcessing || planType === "BASIC"}
                      className="w-full"
                      variant={planType === "BASIC" ? "secondary" : "default"}
                    >
                      {planType === "BASIC" ? (
                        "Current Plan"
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4 mr-2" />
                          Subscribe to Basic
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Pro Plan */}
                <Card className="border-2">
                  <CardHeader>
                    <CardTitle>Pro Plan</CardTitle>
                    <CardDescription>$20/month</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>20,000 credits included</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>~200 PDF extractions</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>Monthly subscription</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleSubscribe("PRO")}
                      disabled={isProcessing || planType === "PRO"}
                      className="w-full"
                      variant={planType === "PRO" ? "secondary" : "default"}
                    >
                      {planType === "PRO" ? (
                        "Current Plan"
                      ) : planType === "BASIC" ? (
                        <>
                          <Zap className="h-4 w-4 mr-2" />
                          Upgrade to Pro
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4 mr-2" />
                          Subscribe to Pro
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Manage Billing */}
              {hasSubscription && (
                <div className="border-t pt-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        Manage Subscription
                      </h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Update your payment method, view invoices, or cancel
                        your subscription through the Stripe Customer Portal.
                      </p>
                      <Button
                        onClick={handleManageBilling}
                        disabled={isProcessing}
                        variant="outline"
                        className="w-full sm:w-auto"
                      >
                        {isProcessing ? (
                          <>
                            <LoadingSpinner size="sm" className="mr-2" />
                            Loading...
                          </>
                        ) : (
                          <>
                            <CreditCard className="h-4 w-4 mr-2" />
                            Manage Billing
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Insufficient Credits Warning */}
              {credits < 100 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                        Low Credits
                      </h4>
                      <p className="text-sm text-yellow-700 dark:text-yellow-300">
                        You have {credits} credits remaining. You need at least
                        100 credits to extract a PDF. Consider subscribing to a
                        plan to get more credits.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
