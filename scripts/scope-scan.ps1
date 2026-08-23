$dir = "src\controllers";
$scopedModels = @('accountings','allotments','auto_transfers','baggages','bars','bar_inclusives','batch_reports','cancelation_rules','car_parks','code_billings','code_gls','code_items','code_posts','company_profiles','companies','content_banners','day_use_rates','deposit_events','deposit_payments','dynamic_rate_configs','dynamic_rate_results','email_builders','events','folios','guest_listings','guest_profiles','guest_profile_documents','guest_profile_family_members','guest_profile_histories','guest_profile_preferences','holidays','hotel_competitors','housekeeper_histories','last_user_folios','log_audits','lost_and_founds','messages','other_guests','overbookings','packages','payment_matrix','phonebooks','pos_matrix_sales','post_code_budgets','promotions','rates','rate_configs','rate_inclusives','rate_rates','reservations','reservation_items','rooms','room_allotments','room_availabilities','room_inventories','room_types','rosters','settings','shifts','shift_confirmations','shift_rosters','shift_user_lists','statistic_messages','statistic_rate_codes','stocks','stop_sells','system_balances','transactions','transaction_breakdowns','transaction_temps','types','type_payments','wake_up_calls','work_orders','work_order_stocks','yields','rate_day_uses','company_profile_billing_setups','housekeeping_setups');
$results = @();
Get-ChildItem $dir -Recurse -Include "*.ts" -File | Where-Object { $_.Name -notlike "*.test.ts" } | ForEach-Object {
  $file = $_.FullName.Replace('C:\Users\uzuma\Documents\hms-anyaman\backend-node\','');
  $lines = Get-Content $_.FullName;
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'prisma\.(' + ($scopedModels -join '|') + ')\.(findMany|count|aggregate|groupBy)\(') {
      $model = $Matches[1]; $kind = $Matches[2];
      # look ahead 12 lines for property_id
      $window = ($lines[$i..([Math]::Min($i+12, $lines.Count-1))] -join "`n");
      if ($window -notmatch 'property_id') {
        $results += [PSCustomObject]@{ File=$file; Line=$i+1; Model=$model; Kind=$kind; Snip=$lines[$i].Trim().Substring(0,[Math]::Min(90,$lines[$i].Trim().Length)) };
      }
    }
  }
};
$results | Format-Table -AutoSize -Wrap | Out-String -Width 200
Write-Output ("TOTAL_CANDIDATES=" + $results.Count)
