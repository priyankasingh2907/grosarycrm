import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../core/api/api_client.dart';
import '../auth/auth_repository.dart';

class PosScreen extends StatefulWidget {
  const PosScreen({required this.session, super.key});
  final UserSession session;

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  late final ApiClient _api;
  final _search = TextEditingController();
  final Map<String, _CartLine> _cart = {};
  List<Map<String, dynamic>> _products = [];
  List<Map<String, dynamic>> _stores = [];
  String? _storeId;
  String _paymentMethod = 'cash';
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _api = context.read<ApiClient>();
    _loadStores();
    _searchProducts();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadStores() async {
    try {
      final response = await _api.dio.get<List<dynamic>>('/stores');
      if (!mounted) return;
      setState(() {
        _stores = response.data!.cast<Map<String, dynamic>>();
        _storeId = widget.session.storeIds.isNotEmpty
            ? widget.session.storeIds.first
            : _stores.isNotEmpty ? _stores.first['id'] as String : null;
      });
      await _searchProducts();
    } on DioException catch (error) {
      if (mounted) setState(() => _error = error.message ?? 'Could not load stores');
    }
  }

  Future<void> _searchProducts() async {
    try {
      final response = await _api.dio.get<Map<String, dynamic>>(
        '/catalog/products', queryParameters: {'search': _search.text.trim(), 'pageSize': 50, if (_storeId != null) 'storeId': _storeId},
      );
      if (mounted) setState(() => _products = (response.data!['items'] as List).cast<Map<String, dynamic>>());
    } on DioException catch (error) {
      if (mounted) setState(() => _error = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : 'Could not load product catalog');
    }
  }

  void _addProduct(Map<String, dynamic> product) {
    final id = product['id'] as String;
    setState(() {
      final current = _cart[id];
      _cart[id] = current == null ? _CartLine(product, 1) : current.copyWith(quantity: current.quantity + 1);
      _error = null;
    });
  }

  double get _total => _cart.values.fold(0, (sum, line) {
        final price = double.parse(line.product['sellingPrice'].toString());
        final taxRate = double.parse(line.product['taxRate'].toString());
        return sum + (price * line.quantity * (1 + taxRate / 100));
      });

  Future<void> _openDrawer() async {
    if (_storeId == null) return;
    try {
      await _api.dio.post('/operations/cash/open', data: {'storeId': _storeId, 'openingCash': 0});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cash drawer opened')));
    } on DioException catch (error) {
      setState(() => _error = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : 'Could not open cash drawer');
    }
  }

  Future<void> _checkout() async {
    if (_storeId == null || _cart.isEmpty) return;
    setState(() { _loading = true; _error = null; });
    try {
      final response = await _api.dio.post<Map<String, dynamic>>('/sales/checkout', data: {
        'storeId': _storeId,
        'items': _cart.values.map((line) => {'productId': line.product['id'], 'quantity': line.quantity, 'discountAmount': 0}).toList(),
        'payments': [{'method': _paymentMethod, 'amount': double.parse(_total.toStringAsFixed(2))}],
      });
      if (!mounted) return;
      final invoice = response.data!;
      setState(() => _cart.clear());
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Sale complete'),
          content: SelectableText('${invoice['invoiceNumber']}\nTotal: ${invoice['totalAmount']}'),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))],
        ),
      );
      await _searchProducts();
    } on DioException catch (error) {
      setState(() => _error = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['error']?.toString()
          : 'Checkout failed');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
        final compact = constraints.maxWidth < 760;
        final catalog = _catalogPane();
        final cart = _cartPane();
        return Padding(
          padding: EdgeInsets.all(compact ? 14 : 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Point of sale', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                const SizedBox(height: 4),
                Text('Scan or search products to start a sale.', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A))),
              ])),
              if (_stores.isNotEmpty) SizedBox(
                width: compact ? 145 : 240,
                child: DropdownButtonFormField<String>(
                  value: _storeId,
                  decoration: const InputDecoration(labelText: 'Store', isDense: true, prefixIcon: Icon(Icons.store_outlined, size: 19)),
                  items: _stores.map((store) => DropdownMenuItem(value: store['id'] as String, child: Text(store['name'] as String, overflow: TextOverflow.ellipsis))).toList(),
                  onChanged: (value) {
                    setState(() {
                      _storeId = value;
                      _cart.clear();
                    });
                    _searchProducts();
                  },
                ),
              ),
            ]),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
            const SizedBox(height: 16),
            Expanded(child: compact ? Column(children: [Expanded(child: catalog), const SizedBox(height: 14), Expanded(child: cart)]) : Row(children: [Expanded(flex: 6, child: catalog), const SizedBox(width: 18), Expanded(flex: 5, child: cart)])),
          ]),
        );
      });

  Widget _catalogPane() => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE5ECE7))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(
            controller: _search,
            decoration: InputDecoration(
              hintText: 'Find product or scan barcode',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: IconButton(onPressed: _searchProducts, tooltip: 'Search', icon: const Icon(Icons.arrow_forward_rounded)),
            ),
            onSubmitted: (_) => _searchProducts(),
          ),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: Text('Products', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
            Text('${_products.length} found', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF74847A))),
          ]),
          const SizedBox(height: 8),
          Expanded(child: _products.isEmpty
              ? const Center(child: Text('No products found. Try another search.'))
              : ListView.separated(
                  itemCount: _products.length,
                  separatorBuilder: (_, __) => const Divider(height: 1, indent: 54),
                  itemBuilder: (context, index) {
                    final product = _products[index];
                    return ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(color: const Color(0xFFEAF5ED), borderRadius: BorderRadius.circular(12)),
                        child: const Icon(Icons.local_grocery_store_outlined, size: 19, color: Color(0xFF247A57)),
                      ),
                      title: Text(product['name'] as String, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${product['sku']}  ·  ${product['unit']}  ·  Stock ${product['stockQuantity'] ?? 0}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text(double.parse(product['sellingPrice'].toString()).toStringAsFixed(2), style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(width: 8),
                        const Icon(Icons.add_circle_outline_rounded, color: Color(0xFF247A57)),
                      ]),
                      onTap: () => _addProduct(product),
                    );
                  },
                )),
        ]),
      );

  Widget _cartPane() => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFE5ECE7))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text('Current sale', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(color: const Color(0xFFF0F5F1), borderRadius: BorderRadius.circular(20)),
              child: Text('${_cart.length} ${_cart.length == 1 ? 'item' : 'items'}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ]),
          const Divider(height: 24),
          Expanded(child: _cart.isEmpty
              ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.shopping_basket_outlined, size: 38, color: Color(0xFFA5B2A9)),
                  SizedBox(height: 10),
                  Text('Your basket is empty'),
                  SizedBox(height: 4),
                  Text('Choose a product to add it to this sale.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Color(0xFF74847A))),
                ]))
              : ListView(children: _cart.entries.map((entry) {
                  final line = entry.value;
                  final price = double.parse(line.product['sellingPrice'].toString()) * (1 + double.parse(line.product['taxRate'].toString()) / 100);
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(line.product['name'] as String, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${price.toStringAsFixed(2)} × ${line.quantity}'),
                    leading: IconButton(tooltip: 'Remove one', onPressed: () => setState(() {
                      if (line.quantity <= 1) { _cart.remove(entry.key); } else { _cart[entry.key] = line.copyWith(quantity: line.quantity - 1); }
                    }), icon: const Icon(Icons.remove_circle_outline)),
                    trailing: Text((price * line.quantity).toStringAsFixed(2), style: const TextStyle(fontWeight: FontWeight.w700)),
                  );
                }).toList())),
          const Divider(height: 24),
          Row(children: [
            const Text('Total', style: TextStyle(fontWeight: FontWeight.w600)),
            const Spacer(),
            Text(_total.toStringAsFixed(2), style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: _paymentMethod,
            decoration: const InputDecoration(labelText: 'Payment method', isDense: true, prefixIcon: Icon(Icons.payments_outlined, size: 19)),
            items: const [DropdownMenuItem(value: 'cash', child: Text('Cash')), DropdownMenuItem(value: 'card', child: Text('Card')), DropdownMenuItem(value: 'upi', child: Text('UPI')), DropdownMenuItem(value: 'other', child: Text('Other'))],
            onChanged: (value) => setState(() => _paymentMethod = value ?? 'cash'),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 48,
            child: FilledButton.icon(
              onPressed: _loading || _cart.isEmpty ? null : _checkout,
              icon: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.receipt_long_rounded),
              label: const Text('Complete sale'),
            ),
          ),
          if (_paymentMethod == 'cash') TextButton.icon(onPressed: _openDrawer, icon: const Icon(Icons.point_of_sale_outlined), label: const Text('Open cash drawer')),
        ]),
      );
}

class _CartLine {
  const _CartLine(this.product, this.quantity);
  final Map<String, dynamic> product;
  final int quantity;
  _CartLine copyWith({int? quantity}) => _CartLine(product, quantity ?? this.quantity);
}
