"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutModal } from "@/components/sign-out-modal";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  FileText,
  Settings,
  LogOut,
  User,
  Brain,
  ArrowRight,
  Menu,
  X,
} from "lucide-react";

interface NavigationProps {
  currentPage?: string;
  showPublicNav?: boolean;
}

export function Navigation({
  currentPage,
  showPublicNav = false,
}: NavigationProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const handleSignOutClick = () => {
    // Close mobile menu if open
    setMobileMenuOpen(false);
    // Show confirmation modal
    setShowSignOutModal(true);
  };

  const handleConfirmSignOut = async () => {
    try {
      setIsSigningOut(true);

      // Show toast notification
      toast.loading("Signing out...", { id: "signout" });

      // Sign out with callback to home page
      // Using redirect: true to let NextAuth handle the redirect
      await signOut({
        callbackUrl: "/",
        redirect: true,
      });

      // This won't execute if redirect happens, but toast will show
      toast.success("Signed out successfully", { id: "signout" });
    } catch (error) {
      console.error("Sign out error:", error);
      toast.error("Failed to sign out. Please try again.", { id: "signout" });
      setIsSigningOut(false);
      setShowSignOutModal(false);
    }
  };

  const handleCloseSignOutModal = () => {
    if (!isSigningOut) {
      setShowSignOutModal(false);
    }
  };

  const handleTryItNow = () => {
    router.push("/auth/signin");
  };

  // Public navigation (for home page)
  if (showPublicNav || !session) {
    return (
      <nav className="bg-white dark:bg-gray-900 shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-2">
              <div className="relative">
                <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-blue-400" />
                <Brain className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400 absolute -top-1 -right-1" />
              </div>
              <h1
                className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white cursor-pointer"
                onClick={() => router.push("/")}
              >
                PDF Extractor AI
              </h1>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
              <ThemeToggle />
              <Button
                onClick={handleTryItNow}
                size="sm"
                className="bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-black text-xs sm:text-sm font-semibold px-3 sm:px-4"
              >
                <span className="hidden sm:inline">Try It Now</span>
                <span className="sm:hidden">Try</span>
                <ArrowRight className="ml-1 sm:ml-2 h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>
    );
  }

  // Authenticated navigation (dashboard)

  return (
    <nav className="bg-white dark:bg-gray-900 shadow-lg border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-4 sm:space-x-8">
            <div className="flex items-center space-x-2">
              <div className="relative">
                <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-blue-400" />
                <Brain className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400 absolute -top-1 -right-1" />
              </div>
              <h1
                className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white cursor-pointer"
                onClick={() => router.push("/dashboard")}
              >
                PDF Extractor AI
              </h1>
            </div>

            <div className="hidden md:flex items-center space-x-4">
              <Button
                variant={currentPage === "dashboard" ? "default" : "ghost"}
                size="sm"
                onClick={() => (window.location.href = "/dashboard")}
                className={
                  currentPage === "dashboard"
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                }
              >
                Dashboard
              </Button>
              <Button
                variant={currentPage === "settings" ? "default" : "ghost"}
                size="sm"
                onClick={() => router.push("/settings")}
                className={
                  currentPage === "settings"
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                }
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="hidden sm:flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Badge className="bg-purple-900 text-purple-300 border-purple-700">
                  FREE
                </Badge>
              </div>
              <div className="hidden lg:block text-right">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {session.user?.name || session.user?.email}
                </p>
              </div>
              <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center border border-gray-300 dark:border-gray-600">
                <User className="h-4 w-4 text-gray-700 dark:text-gray-300" />
              </div>
            </div>

            <ThemeToggle />

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5 text-gray-900 dark:text-white" />
              ) : (
                <Menu className="h-5 w-5 text-gray-900 dark:text-white" />
              )}
            </Button>

            {/* Desktop sign out */}
            <Button
              onClick={handleSignOutClick}
              variant="outline"
              size="sm"
              disabled={isSigningOut}
              className="hidden md:flex border-gray-300 dark:border-gray-600 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700 py-4 space-y-2 bg-white dark:bg-gray-900">
            <Button
              variant={currentPage === "dashboard" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                router.push("/dashboard");
                setMobileMenuOpen(false);
              }}
              className={`w-full justify-start ${
                currentPage === "dashboard"
                  ? "bg-blue-600 text-white"
                  : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              Dashboard
            </Button>
            <Button
              variant={currentPage === "settings" ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                router.push("/settings");
                setMobileMenuOpen(false);
              }}
              className={`w-full justify-start ${
                currentPage === "settings"
                  ? "bg-blue-600 text-white"
                  : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 mt-2">
              <div className="flex items-center space-x-2 mb-2">
                <User className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {session.user?.name || session.user?.email}
                </p>
              </div>
              <Button
                onClick={handleSignOutClick}
                variant="outline"
                size="sm"
                disabled={isSigningOut}
                className="w-full justify-start text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        )}

        {/* Sign Out Confirmation Modal */}
        <SignOutModal
          isOpen={showSignOutModal}
          onClose={handleCloseSignOutModal}
          onConfirm={handleConfirmSignOut}
          isSigningOut={isSigningOut}
        />
      </div>
    </nav>
  );
}
