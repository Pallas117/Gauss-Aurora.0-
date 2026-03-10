import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { fetchAdminUsers, type AdminUserRow } from "@/lib/api/heliophysics-proxy";

const AdminUsersPage = () => {
  const mission = useMissionSnapshot();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = mission.session?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    fetchAdminUsers()
      .then((data) => setUsers(data.users))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!mission.session?.authRequired) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">
          Auth bypass is active. Set AUTH_REQUIRED=true to test admin users list.
        </p>
      </div>
    );
  }

  if (!mission.session?.authenticated) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Sign in to access this page.</p>
        <Button variant="outline" asChild className="mt-2">
          <Link to="/heliophysics">Go to mission console</Link>
        </Button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Admin role required to view registered users.</p>
        <Button variant="outline" asChild className="mt-2">
          <Link to="/heliophysics">Back to mission console</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/heliophysics">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Registered users
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Team / who is signed up</CardTitle>
          <p className="text-sm text-muted-foreground">
            Users registered via Supabase Auth. Data from auth.admin.listUsers.
          </p>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {error && (
            <p className="text-destructive text-sm py-2">{error}</p>
          )}
          {!loading && !error && users.length === 0 && (
            <p className="text-muted-foreground text-sm py-4">No users found.</p>
          )}
          {!loading && !error && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 pr-4 font-medium">Role</th>
                    <th className="pb-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{u.email ?? "—"}</td>
                      <td className="py-2 pr-4">{u.role ?? "viewer"}</td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(u.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminUsersPage;
