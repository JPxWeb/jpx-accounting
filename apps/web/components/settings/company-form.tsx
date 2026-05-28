"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type CompanySettings, companySettingsSchema } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { ScreenSkeleton } from "../ui/skeleton";

function CompanyFormFields({ defaultData }: { defaultData: CompanySettings }) {
  const queryClient = useQueryClient();

  const form = useForm<CompanySettings>({
    // @hookform/resolvers v5.2 has an overload-resolution bug on Zod v4 schemas:
    // TS picks the Zod 3 overload first and fails on a missing `_def.typeName`.
    // The runtime is correct (resolver duck-types the schema). Cast keeps the
    // call site type-safe for the form (useForm<CompanySettings>) without
    // affecting runtime behavior.
    resolver: zodResolver(companySettingsSchema as never),
    defaultValues: defaultData,
  });

  const mutation = useMutation({
    mutationFn: (input: CompanySettings) => apiClient.saveCompanySettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["company-settings"], saved);
      toast.success("Company settings saved.");
    },
    onError: () => {
      toast.error("Could not save company settings.");
    },
  });

  return (
    <Form {...form}>
      <form
        data-testid="company-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="organizationName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="organizationNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization number</FormLabel>
              <FormControl>
                <Input placeholder="556677-8899" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="addressLine1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal code</FormLabel>
                <FormControl>
                  <Input placeholder="111 22" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending} data-testid="company-form-submit">
          {mutation.isPending ? "Saving…" : "Save company"}
        </Button>
      </form>
    </Form>
  );
}

const EMPTY_COMPANY_SETTINGS: CompanySettings = {
  organizationId: "org_default",
  organizationName: "",
  organizationNumber: "",
  addressLine1: "",
  postalCode: "",
  city: "",
  contactEmail: "",
};

export function CompanyForm() {
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  if (settingsQuery.isLoading) return <ScreenSkeleton />;

  return <CompanyFormFields defaultData={settingsQuery.data ?? EMPTY_COMPANY_SETTINGS} />;
}
