import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/api_client.dart';
import '../auth/auth_cubit.dart';
import '../auth/auth_repository.dart';
import 'pos_screen.dart';
import 'workspace_cubit.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({required this.session, super.key});
  final UserSession session;

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (context) => WorkspaceCubit(context.read<ApiClient>())..select('home'),
        child: _Workspace(session: session),
      );
}

class _Workspace extends StatelessWidget {
  const _Workspace({required this.session});
  final UserSession session;

  static const _allSections = <_SectionItem>[
    _SectionItem('home', 'Overview', Icons.space_dashboard_outlined, 'dashboard:read', 'WORKSPACE'),
    _SectionItem('pos', 'Point of sale', Icons.point_of_sale_outlined, 'sales:write', 'SALES'),
    _SectionItem('sales', 'Sales & invoices', Icons.receipt_long_outlined, 'sales:read', 'SALES'),
    _SectionItem('customers', 'Customers', Icons.people_outline, 'customers:read', 'SALES'),
    _SectionItem('cash', 'Cash drawer', Icons.account_balance_wallet_outlined, 'cash:manage', 'SALES'),
    _SectionItem('catalog', 'Product catalog', Icons.inventory_2_outlined, 'catalog:read', 'INVENTORY & SUPPLY'),
    _SectionItem('inventory', 'Stock levels', Icons.warehouse_outlined, 'inventory:read', 'INVENTORY & SUPPLY'),
    _SectionItem('transfers', 'Stock transfers', Icons.swap_horiz, 'inventory:transfer', 'INVENTORY & SUPPLY'),
    _SectionItem('movements', 'Stock movements', Icons.history, 'inventory:read', 'INVENTORY & SUPPLY'),
    _SectionItem('expiry', 'Expiry alerts', Icons.event_busy_outlined, 'inventory:read', 'INVENTORY & SUPPLY'),
    _SectionItem('purchases', 'Purchasing', Icons.local_shipping_outlined, 'purchasing:read', 'INVENTORY & SUPPLY'),
    _SectionItem('expenses', 'Expenses', Icons.payments_outlined, 'expenses:read', 'FINANCE & INSIGHTS'),
    _SectionItem('reports', 'Reports', Icons.query_stats, 'reports:read', 'FINANCE & INSIGHTS'),
    _SectionItem('stores', 'Stores', Icons.store_outlined, 'stores:read', 'ADMINISTRATION'),
    _SectionItem('users', 'Team', Icons.manage_accounts_outlined, 'users:manage', 'ADMINISTRATION'),
    _SectionItem('roles', 'Roles & access', Icons.admin_panel_settings_outlined, 'roles:manage', 'ADMINISTRATION'),
  ];

  List<_SectionItem> get _sections => _allSections.where((section) => session.permissions.contains(section.permission)).toList();

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
        final wide = constraints.maxWidth >= 960;
        return BlocBuilder<WorkspaceCubit, WorkspaceState>(builder: (context, state) {
          final sections = _sections;
          final selectedIndex = sections.indexWhere((item) => item.key == state.section);
          final selected = selectedIndex < 0 ? null : sections[selectedIndex];
          final nav = _navigation(context, sections, state.section, wide);
          return Scaffold(
            appBar: AppBar(
              title: selected == null
                  ? const Text('Grocery CRM')
                  : Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(selected.icon, size: 21, color: Theme.of(context).colorScheme.primary),
                      const SizedBox(width: 10),
                      Text(selected.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
              actions: [
                IconButton(
                  tooltip: 'Refresh',
                  onPressed: () => context.read<WorkspaceCubit>().refresh(),
                  icon: const Icon(Icons.refresh_rounded),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Center(
                    child: CircleAvatar(
                      radius: 17,
                      backgroundColor: const Color(0xFFE3F1E8),
                      child: Text(
                        session.email.isEmpty ? '?' : session.email[0].toUpperCase(),
                        style: TextStyle(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Sign out',
                  onPressed: () => context.read<AuthCubit>().logout(),
                  icon: const Icon(Icons.logout_rounded),
                ),
                const SizedBox(width: 12),
              ],
            ),
            drawer: wide
                ? null
                : Drawer(
                    width: 292,
                    backgroundColor: const Color(0xFFF2F6F3),
                    child: SafeArea(child: nav),
                  ),
            body: Row(children: [
              if (wide)
                SizedBox(
                  width: 260,
                  child: DecoratedBox(
                    decoration: const BoxDecoration(
                      color: Color(0xFFF2F6F3),
                      border: Border(right: BorderSide(color: Color(0xFFE5ECE7))),
                    ),
                    child: SafeArea(child: nav),
                  ),
                ),
              Expanded(child: _content(context, state)),
            ]),
          );
        });
      });

  Widget _navigation(BuildContext context, List<_SectionItem> sections, String selected, bool wide) {
    final groups = <String, List<_SectionItem>>{};
    for (final item in sections) {
      groups.putIfAbsent(item.group, () => []).add(item);
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 20),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 4, 10, 24),
          child: Row(children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(14)),
              child: const Icon(Icons.eco_rounded, color: Colors.white, size: 24),
            ),
            const SizedBox(width: 11),
            const Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Greenbasket', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: -0.3)),
                SizedBox(height: 2),
                Text('STORE OPERATIONS', style: TextStyle(fontSize: 9, letterSpacing: 1.2, color: Color(0xFF74847A), fontWeight: FontWeight.w700)),
              ]),
            ),
          ]),
        ),
        for (final group in groups.entries) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 12, 10, 7),
            child: Text(group.key, style: const TextStyle(fontSize: 10, letterSpacing: 1.1, fontWeight: FontWeight.w800, color: Color(0xFF829087))),
          ),
          for (final item in group.value)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: ListTile(
                selected: item.key == selected,
                selectedTileColor: const Color(0xFFDDEFE3),
                leading: Icon(item.icon, size: 20),
                title: Text(item.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                minLeadingWidth: 24,
                horizontalTitleGap: 10,
                visualDensity: const VisualDensity(vertical: -1),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                onTap: () {
                  context.read<WorkspaceCubit>().select(item.key);
                  if (!wide) Navigator.pop(context);
                },
              ),
            ),
        ],
        const SizedBox(height: 20),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 4),
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE4EBE6))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.verified_user_outlined, size: 17, color: Color(0xFF247A57)),
              const SizedBox(width: 7),
              Text('Secure workspace', style: Theme.of(context).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 6),
            Text(
              session.roles.map(_prettyRole).join(' · '),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A), height: 1.4),
            ),
          ]),
        ),
      ],
    );
  }

  Widget _content(BuildContext context, WorkspaceState state) {
    if (state.section == 'pos') return PosScreen(session: session);
    if (state.loading) return const Center(child: CircularProgressIndicator());
    if (state.error != null) {
      return Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off_outlined, size: 36), const SizedBox(height: 12), Text(state.error!, textAlign: TextAlign.center), const SizedBox(height: 12),
        OutlinedButton.icon(onPressed: () => context.read<WorkspaceCubit>().refresh(), icon: const Icon(Icons.refresh), label: const Text('Try again')),
      ])));
    }
    if (state.section == 'home') return _overview(context, state.rows.isEmpty ? const {} : state.rows.first);
    return _dataSection(context, state);
  }

  Widget _overview(BuildContext context, Map<String, dynamic> data) {
    final cards = <_MetricData>[
      if (data.containsKey('stores')) _MetricData('Stores', data['stores'] ?? 0, Icons.store_outlined),
      if (data.containsKey('todaySales')) _MetricData('Sales today', _money(data['todaySales']), Icons.point_of_sale),
      if (data.containsKey('lowStockProducts')) _MetricData('Low stock', data['lowStockProducts'] ?? 0, Icons.warning_amber_outlined),
      if (data.containsKey('pendingPurchases')) _MetricData('Open purchases', data['pendingPurchases'] ?? 0, Icons.local_shipping_outlined),
    ];
    final quickLinks = _sections.where((item) => const {'pos', 'catalog', 'inventory', 'purchases', 'customers', 'reports'}.contains(item.key)).take(4).toList();
    return ListView(
      padding: const EdgeInsets.all(28),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(26, 24, 20, 24),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFF1E704F), Color(0xFF31946A)], begin: Alignment.topLeft, end: Alignment.bottomRight),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Your store, at a glance', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
              const SizedBox(height: 8),
              Text('Keep stock, sales, and your team moving in one place.', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.white.withOpacity(0.88))),
              const SizedBox(height: 18),
              Text(session.email, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Colors.white.withOpacity(0.9))),
            ])),
            const SizedBox(width: 12),
            const Icon(Icons.eco_rounded, size: 72, color: Color(0x66FFFFFF)),
          ]),
        ),
        const SizedBox(height: 26),
        Row(children: [
          Expanded(child: Text('Today at a glance', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.3))),
          Icon(Icons.calendar_today_outlined, size: 16, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 7),
          Text('Live data', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: const Color(0xFF65756B), fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 14),
        if (cards.isEmpty)
          const _DashboardNotice(message: 'Summary metrics are not available for your account yet.')
        else
          LayoutBuilder(builder: (context, constraints) {
            final columns = constraints.maxWidth > 1100 ? 4 : constraints.maxWidth > 650 ? 2 : 1;
            final width = (constraints.maxWidth - (columns - 1) * 14) / columns;
            return Wrap(
              spacing: 14,
              runSpacing: 14,
              children: cards.map((card) => SizedBox(width: width, child: _MetricTile(metric: card))).toList(),
            );
          }),
        const SizedBox(height: 28),
        Row(children: [
          Expanded(child: Text('Quick access', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.3))),
          Text('Your most-used tools', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A))),
        ]),
        const SizedBox(height: 14),
        LayoutBuilder(builder: (context, constraints) {
          final columns = constraints.maxWidth > 900 ? 4 : constraints.maxWidth > 560 ? 2 : 1;
          final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
          return Wrap(
            spacing: 12,
            runSpacing: 12,
            children: quickLinks.map((item) => SizedBox(
              width: width,
              child: _QuickLink(
                item: item,
                onTap: () => context.read<WorkspaceCubit>().select(item.key),
              ),
            )).toList(),
          );
        }),
        const SizedBox(height: 20),
        const _DashboardNotice(
          message: 'Your account only shows the sections it is allowed to use. The API checks permissions again for every operation.',
          icon: Icons.shield_outlined,
        ),
      ],
    );
  }

  Widget _dataSection(BuildContext context, WorkspaceState state) {
    final item = _sections.firstWhere((entry) => entry.key == state.section);
    final columns = _columns[state.section] ?? const <String>[];
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.label, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4)),
            const SizedBox(height: 5),
            Text('${state.rows.length} ${state.rows.length == 1 ? 'record' : 'records'}', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A))),
          ])),
          if (_canCreate(state.section))
            FilledButton.icon(
              onPressed: () => _showCreateDialog(context, state.section),
              icon: const Icon(Icons.add_rounded, size: 19),
              label: const Text('Create new'),
            ),
        ]),
        const SizedBox(height: 18),
        Expanded(
          child: state.rows.isEmpty
              ? Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Color(0xFFE5ECE7))),
                  child: const Center(child: _EmptyRecords()),
                )
              : Card(
                  elevation: 0,
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Color(0xFFE5ECE7))),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: SingleChildScrollView(
                      child: DataTable(
                        headingRowColor: MaterialStateProperty.all(const Color(0xFFF5F8F5)),
                        headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF596A60), fontSize: 12),
                        dataTextStyle: const TextStyle(color: Color(0xFF26352C), fontSize: 13),
                        horizontalMargin: 22,
                        columnSpacing: 28,
                        columns: [
                          ...columns.map((key) => DataColumn(label: Text(_columnLabel(key)))),
                          if (state.section == 'purchases' || state.section == 'transfers' || (state.section == 'sales' && session.permissions.contains('sales:return'))) const DataColumn(label: Text('Actions')),
                        ],
                        rows: state.rows.map((row) => DataRow(cells: [
                          ...columns.map((key) => DataCell(ConstrainedBox(
                                constraints: const BoxConstraints(maxWidth: 240),
                                child: Text(_cellValue(row[key]), maxLines: 2, overflow: TextOverflow.ellipsis),
                              ))),
                          if (state.section == 'purchases' || state.section == 'transfers')
                            DataCell(TextButton(
                              onPressed: row['status'] == (state.section == 'purchases' ? 'ordered' : 'shipped') || (state.section == 'purchases' && row['status'] == 'partially_received')
                                  ? () => state.section == 'purchases' ? _receivePurchase(context, row['id'] as String) : _receiveTransfer(context, row['id'] as String)
                                  : null,
                              child: const Text('Receive'),
                            )),
                          if (state.section == 'sales' && session.permissions.contains('sales:return'))
                            DataCell(TextButton(
                              onPressed: row['status'] == 'completed' ? () => _returnSale(context, row['id'] as String) : null,
                              child: const Text('Return'),
                            )),
                          if (state.section == 'users')
                            DataCell(IconButton(
                              tooltip: row['isActive'] == true ? 'Deactivate user' : 'Activate user',
                              onPressed: () => _toggleUser(context, row),
                              icon: Icon(row['isActive'] == true ? Icons.person_off_outlined : Icons.person_outline),
                            )),
                        ])).toList(),
                      ),
                    ),
                  ),
                ),
        ),
      ]),
    );
  }

  bool _canCreate(String section) => const {'catalog','inventory','transfers','purchases','customers','expenses','cash','stores','users','roles'}.contains(section);

  Future<void> _toggleUser(BuildContext context, Map<String, dynamic> user) async {
    try {
      await context.read<ApiClient>().dio.patch('/admin/users/${user['id']}', data: {'isActive': user['isActive'] != true});
      if (context.mounted) await context.read<WorkspaceCubit>().refresh();
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _showCreateDialog(BuildContext context, String section) async {
    if (section == 'cash') {
      await _cashAction(context);
      return;
    }
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _CreateRecordDialog(api: context.read<ApiClient>(), section: section, session: session),
    );
    if (result == null || !context.mounted) return;
    final routes = {'catalog':'/catalog/products','inventory':'/inventory/adjustments','transfers':'/inventory/transfers','purchases':'/purchases','customers':'/customers','expenses':'/operations/expenses','stores':'/stores','users':'/admin/users','roles':'/admin/roles'};
    try {
      await context.read<WorkspaceCubit>().post(routes[section]!, result);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
    } on DioException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.response?.data is Map<String, dynamic> ? (error.response!.data as Map<String, dynamic>)['error'].toString() : 'Save failed')));
    }
  }

  Future<void> _cashAction(BuildContext context) async {
    final selection = await showDialog<String>(context: context, builder: (context) => AlertDialog(
      title: const Text('Cash drawer'),
      content: const Text('Open a drawer for the next shift or close an active drawer.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(context, 'open'), child: const Text('Open')), FilledButton(onPressed: () => Navigator.pop(context, 'close'), child: const Text('Close'))],
    ));
    if (selection == null || !context.mounted) return;
    try {
      final api = context.read<ApiClient>();
      if (selection == 'open') {
        final stores = await api.dio.get<List<dynamic>>('/stores');
        final ids = session.storeIds.isNotEmpty ? session.storeIds : stores.data!.map((row) => (row as Map<String, dynamic>)['id'] as String).toList();
        await api.dio.post('/operations/cash/open', data: {'storeId': ids.first, 'openingCash': 0});
      } else {
        final current = await api.dio.get<List<dynamic>>('/operations/cash/current');
        if (current.data!.isEmpty) throw StateError('No open drawer found');
        final drawer = current.data!.first as Map<String, dynamic>;
        await api.dio.post('/operations/cash/${drawer['id']}/close', data: {'countedCash': double.tryParse(await _askValue(context, 'Counted cash') ?? '') ?? 0});
      }
      if (context.mounted) await context.read<WorkspaceCubit>().refresh();
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<String?> _askValue(BuildContext context, String label) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(context: context, builder: (context) => AlertDialog(
      title: Text(label), content: TextField(controller: controller, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: label)),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Continue'))],
    ));
    controller.dispose();
    return value;
  }

  Future<void> _receivePurchase(BuildContext context, String id) async {
    try {
      final detail = await context.read<ApiClient>().dio.get<Map<String, dynamic>>('/purchases/$id');
      final items = (detail.data!['items'] as List).cast<Map<String, dynamic>>();
      final receiveItems = items.where((row) => double.parse(row['quantityOrdered'].toString()) > double.parse(row['quantityReceived'].toString())).map((row) => {
        'itemId': row['itemId'],
        'quantity': double.parse(row['quantityOrdered'].toString()) - double.parse(row['quantityReceived'].toString()),
      }).toList();
      if (receiveItems.isEmpty) return;
      await context.read<ApiClient>().dio.post('/purchases/$id/receive', data: {'items': receiveItems});
      if (context.mounted) await context.read<WorkspaceCubit>().refresh();
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _receiveTransfer(BuildContext context, String id) async {
    try {
      await context.read<ApiClient>().dio.post('/inventory/transfers/$id/receive');
      if (context.mounted) await context.read<WorkspaceCubit>().refresh();
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _returnSale(BuildContext context, String saleId) async {
    final reason = await showDialog<String>(context: context, builder: (context) {
      final controller = TextEditingController();
      return AlertDialog(title: const Text('Return sale'), content: TextField(controller: controller, decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder())), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Continue'))]);
    });
    if (reason == null || reason.length < 3 || !context.mounted) return;
    try {
      final response = await context.read<ApiClient>().dio.get<Map<String, dynamic>>('/sales/$saleId');
      final items = (response.data!['items'] as List).cast<Map<String, dynamic>>();
      final returnItems = items.map((item) => {
        'saleItemId': item['id'],
        'quantity': double.parse(item['quantity'].toString()) - double.parse(item['returnedQuantity'].toString()),
      }).where((item) => (item['quantity'] as double) > 0).toList();
      if (returnItems.isEmpty) throw StateError('All sale quantities have already been returned');
      await context.read<ApiClient>().dio.post('/operations/sales/returns', data: {'saleId': saleId, 'reason': reason, 'refundMethod': 'cash', 'items': returnItems});
      if (context.mounted) await context.read<WorkspaceCubit>().refresh();
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  static String _cellValue(dynamic value) {
    if (value == null) return '—';
    if (value is Map || value is List) return jsonEncode(value);
    if (value is String && value.contains('T') && DateTime.tryParse(value) != null) return value.substring(0, 10);
    return value.toString();
  }

  static String _money(dynamic value) => double.parse(value.toString()).toStringAsFixed(2);
  static String _columnLabel(String value) => value.replaceAllMapped(RegExp(r'[A-Z]'), (match) => ' ${match.group(0)}').replaceAll('_', ' ').trim();
  static String _prettyRole(String value) => value.split('_').map((part) => part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}').join(' ');

  static const _columns = <String, List<String>>{
    'catalog':['sku','name','categoryName','unit','costPrice','sellingPrice','stockQuantity'],
    'inventory':['storeName','sku','productName','quantity','reorderLevel','unit'],
    'transfers':['reference','sourceStore','destinationStore','status','createdAt'],
    'movements':['storeName','sku','productName','type','quantity','referenceType','createdAt'],
    'expiry':['storeName','sku','productName','batchNumber','quantity','expiresAt','daysRemaining'],
    'purchases':['reference','supplierName','storeName','status','totalAmount','createdAt'],
    'customers':['name','phone','email','loyaltyPoints','createdAt'],
    'sales':['invoiceNumber','storeName','customerName','status','totalAmount','createdAt'],
    'cash':['storeName','openingCash','cashSales','openedAt'],
    'expenses':['storeName','category','description','amount','paymentMethod','incurredAt'],
    'reports':['date','transactionCount','sales','tax'],
    'stores':['name','code','phone','email','timezone'],
    'users':['fullName','email','roles','storeIds','isActive'],
    'roles':['name','code','permissions'],
  };
}

class _SectionItem {
  const _SectionItem(this.key, this.label, this.icon, this.permission, this.group);
  final String key;
  final String label;
  final IconData icon;
  final String permission;
  final String group;
}

class _MetricData {
  const _MetricData(this.label, this.value, this.icon);
  final String label;
  final Object value;
  final IconData icon;
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.metric});
  final _MetricData metric;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFE5ECE7)),
        ),
        child: Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: const Color(0xFFEAF5ED), borderRadius: BorderRadius.circular(14)),
            child: Icon(metric.icon, color: Theme.of(context).colorScheme.primary, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(metric.label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A), fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text('${metric.value}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4, color: const Color(0xFF1C2D23))),
          ])),
        ]),
      );
}

class _QuickLink extends StatelessWidget {
  const _QuickLink({required this.item, required this.onTap});
  final _SectionItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE5ECE7))),
            child: Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: const Color(0xFFEAF5ED), borderRadius: BorderRadius.circular(12)),
                child: Icon(item.icon, size: 20, color: Theme.of(context).colorScheme.primary),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(item.label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
              const Icon(Icons.arrow_forward_rounded, size: 17, color: Color(0xFF89978E)),
            ]),
          ),
        ),
      );
}

class _DashboardNotice extends StatelessWidget {
  const _DashboardNotice({required this.message, this.icon = Icons.info_outline_rounded});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
        decoration: BoxDecoration(color: const Color(0xFFF0F5F1), borderRadius: BorderRadius.circular(14)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: const Color(0xFF547260)),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF5B6D62), height: 1.5))),
        ]),
      );
}

class _EmptyRecords extends StatelessWidget {
  const _EmptyRecords();

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 54,
          height: 54,
          decoration: const BoxDecoration(color: Color(0xFFEAF5ED), shape: BoxShape.circle),
          child: const Icon(Icons.inventory_2_outlined, color: Color(0xFF247A57)),
        ),
        const SizedBox(height: 14),
        Text('Nothing here yet', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 5),
        Text('New records will appear here when available.', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A))),
      ]);
}

class _CreateRecordDialog extends StatefulWidget {
  const _CreateRecordDialog({required this.api, required this.section, required this.session});
  final ApiClient api;
  final String section;
  final UserSession session;
  @override
  State<_CreateRecordDialog> createState() => _CreateRecordDialogState();
}

class _CreateRecordDialogState extends State<_CreateRecordDialog> {
  final _formKey = GlobalKey<FormState>();
  final Map<String, TextEditingController> _controllers = {};
  final Map<String, List<Map<String, dynamic>>> _options = {};
  final Map<String, String?> _selected = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _loadOptions(); }
  @override
  void dispose() { for (final controller in _controllers.values) { controller.dispose(); } super.dispose(); }

  Future<void> _loadOptions() async {
    final endpoints = <String, String>{
      if (widget.section == 'catalog') 'units':'/catalog/units',
      if (widget.section == 'catalog') 'categories':'/catalog/categories',
      if (widget.section == 'inventory' || widget.section == 'purchases' || widget.section == 'expenses') 'stores':'/stores',
      if (widget.section == 'transfers') 'stores':'/stores',
      if (widget.section == 'inventory' || widget.section == 'purchases') 'products':'/catalog/products',
      if (widget.section == 'transfers') 'products':'/catalog/products',
      if (widget.section == 'purchases') 'suppliers':'/purchases/suppliers',
      if (widget.section == 'users') 'roles':'/admin/roles',
      if (widget.section == 'users') 'stores':'/stores',
    };
    try {
      for (final entry in endpoints.entries) {
        final response = await widget.api.dio.get<dynamic>(entry.value, queryParameters: entry.key == 'products' ? {'pageSize': 100} : null);
        final payload = response.data;
        _options[entry.key] = payload is Map<String, dynamic>
            ? (payload['items'] as List).cast<Map<String, dynamic>>()
            : (payload as List).cast<Map<String, dynamic>>();
      }
      if (mounted) setState(() => _loading = false);
    } catch (error) { if (mounted) setState(() { _loading = false; _error = error.toString(); }); }
  }

  String? _initial(String name) {
    final options = _options[name] ?? const [];
    if (name == 'stores' && widget.session.storeIds.isNotEmpty) return widget.session.storeIds.first;
    return options.isNotEmpty ? options.first['id']?.toString() ?? options.first['code']?.toString() : null;
  }

  Widget _text(String key, String label, {bool numeric = false, bool required = true, bool password = false, String? initial}) {
    final controller = _controllers.putIfAbsent(key, () => TextEditingController(text: initial ?? ''));
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(
      controller: controller, obscureText: password,
      keyboardType: numeric ? const TextInputType.numberWithOptions(decimal: true, signed: true) : TextInputType.text,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
      validator: (value) {
        if (required && (value == null || value.trim().isEmpty)) return '$label is required';
        if (numeric && value != null && value.isNotEmpty && double.tryParse(value) == null) return 'Enter a valid number';
        return null;
      },
    ));
  }

  Widget _dropdown(String key, String label, String optionsKey, {String idKey = 'id', String labelKey = 'name', bool optional = false}) {
    final options = _options[optionsKey] ?? const [];
    final available = options.map((row) => row[idKey].toString()).toSet();
    final selected = available.contains(_selected[key]) ? _selected[key] : _initial(optionsKey);
    _selected[key] ??= selected;
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: DropdownButtonFormField<String>(
      value: selected,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
      items: [if (optional) const DropdownMenuItem(value: '', child: Text('None')), ...options.map((row) => DropdownMenuItem(value: row[idKey].toString(), child: Text(row[labelKey]?.toString() ?? row[idKey].toString(), overflow: TextOverflow.ellipsis)))],
      onChanged: options.isEmpty && !optional ? null : (value) => setState(() => _selected[key] = value),
      validator: (value) => !optional && (value == null || value.isEmpty) ? 'Select $label' : null,
    ));
  }

  List<Widget> _fields() {
    switch (widget.section) {
      case 'catalog': return [
        _text('sku','SKU'), _text('name','Product name'), _dropdown('baseUnitId','Unit','units', labelKey:'abbreviation'),
        _dropdown('categoryId','Category','categories', optional:true), _text('costPrice','Cost price',numeric:true,initial:'0'),
        _text('sellingPrice','Selling price',numeric:true), _text('taxRate','Tax rate (%)',numeric:true,required:false,initial:'0'), _text('barcode','Barcode',required:false),
      ];
      case 'customers': return [_text('name','Customer name'),_text('phone','Phone',required:false),_text('email','Email',required:false)];
      case 'inventory': return [_dropdown('storeId','Store','stores'),_dropdown('productId','Product','products',labelKey:'name'),_text('quantityDelta','Quantity change',numeric:true),_text('reorderLevel','Reorder level',numeric:true,required:false),_text('reason','Reason')];
      case 'transfers': return [_dropdown('sourceStoreId','Source store','stores'),_dropdown('destinationStoreId','Destination store','stores'),_dropdown('productId','Product','products',labelKey:'name'),_text('quantity','Quantity',numeric:true),_text('reference','Reference',required:false)];
      case 'purchases': return [_dropdown('storeId','Store','stores'),_dropdown('supplierId','Supplier','suppliers'),_dropdown('productId','Product','products',labelKey:'name'),_text('quantity','Quantity',numeric:true),_text('unitCost','Unit cost',numeric:true),_text('taxRate','Tax rate (%)',numeric:true,required:false,initial:'0'),_text('reference','Reference',required:false)];
      case 'expenses': return [_dropdown('storeId','Store','stores'),_text('category','Category'),_text('description','Description'),_text('amount','Amount',numeric:true),_dropdown('paymentMethod','Payment method','paymentMethods',idKey:'value',labelKey:'label')];
      case 'stores': return [_text('name','Store name'),_text('code','Store code'),_text('timezone','Timezone',required:false,initial:'UTC')];
      case 'users': return [_text('fullName','Full name'),_text('email','Email'),_text('password','Temporary password (12+ characters)',password:true),_dropdown('roleCode','Role','roles',idKey:'code'),_dropdown('storeId','Assigned store','stores')];
      case 'roles': return [_text('code','Role code'),_text('name','Role name'),_text('permissions','Permission codes (comma-separated)',required:false)];
      default: return [];
    }
  }

  Map<String, dynamic>? _body() {
    double number(String key) => double.tryParse(_controllers[key]?.text.trim() ?? '') ?? 0;
    switch (widget.section) {
      case 'catalog': return {
        'sku':_controllers['sku']!.text.trim(),'name':_controllers['name']!.text.trim(),'baseUnitId':_selected['baseUnitId'],
        'categoryId':(_selected['categoryId'] ?? '').isEmpty ? null : _selected['categoryId'],
        'costPrice':number('costPrice'),'sellingPrice':number('sellingPrice'),'taxRate':number('taxRate'),
        if ((_controllers['barcode']?.text.trim() ?? '').isNotEmpty) 'barcode':_controllers['barcode']!.text.trim(),
      };
      case 'customers': return {'name':_controllers['name']!.text.trim(),'phone':_controllers['phone']!.text.trim(),'email':_controllers['email']!.text.trim().isEmpty ? null : _controllers['email']!.text.trim()};
      case 'inventory': return {'storeId':_selected['storeId'],'productId':_selected['productId'],'quantityDelta':number('quantityDelta'),'reorderLevel':_controllers['reorderLevel']!.text.isEmpty ? null : number('reorderLevel'),'reason':_controllers['reason']!.text.trim()};
      case 'transfers': return {'sourceStoreId':_selected['sourceStoreId'],'destinationStoreId':_selected['destinationStoreId'],'reference':_controllers['reference']!.text.trim().isEmpty ? 'TR-${DateTime.now().millisecondsSinceEpoch}' : _controllers['reference']!.text.trim(),'items':[{'productId':_selected['productId'],'quantity':number('quantity')}]};
      case 'purchases': return {'storeId':_selected['storeId'],'supplierId':_selected['supplierId'],'reference':_controllers['reference']!.text.trim().isEmpty ? 'PO-${DateTime.now().millisecondsSinceEpoch}' : _controllers['reference']!.text.trim(),'items':[{'productId':_selected['productId'],'quantity':number('quantity'),'unitCost':number('unitCost'),'taxRate':number('taxRate')}]};
      case 'expenses': return {'storeId':_selected['storeId'],'category':_controllers['category']!.text.trim(),'description':_controllers['description']!.text.trim(),'amount':number('amount'),'paymentMethod':_selected['paymentMethod']};
      case 'stores': return {'name':_controllers['name']!.text.trim(),'code':_controllers['code']!.text.trim(),'timezone':_controllers['timezone']!.text.trim().isEmpty ? 'UTC' : _controllers['timezone']!.text.trim()};
      case 'users': return {'fullName':_controllers['fullName']!.text.trim(),'email':_controllers['email']!.text.trim(),'password':_controllers['password']!.text,'roleCode':_selected['roleCode'],'storeIds':[_selected['storeId']]};
      case 'roles': return {'code':_controllers['code']!.text.trim(),'name':_controllers['name']!.text.trim(),'permissions':(_controllers['permissions']?.text ?? '').split(',').map((value) => value.trim()).where((value) => value.isNotEmpty).toList()};
      default: return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.section == 'expenses') {
      _options.putIfAbsent('paymentMethods', () => const [{'value':'cash','label':'Cash'},{'value':'card','label':'Card'},{'value':'upi','label':'UPI'},{'value':'bank','label':'Bank'},{'value':'other','label':'Other'}]);
    }
    return AlertDialog(
      title: Text('New ${widget.section} record'),
      content: SizedBox(width: 440, child: _loading ? const SizedBox(height: 120, child: Center(child: CircularProgressIndicator())) : _error != null ? Text(_error!) : Form(
        key: _formKey,
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: _fields())),
      )),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(onPressed: _loading || _error != null ? null : () {
        if (_formKey.currentState!.validate()) Navigator.pop(context, _body());
      }, child: const Text('Save'))],
    );
  }
}
