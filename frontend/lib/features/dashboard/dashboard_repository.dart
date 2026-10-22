import '../../core/api/api_client.dart';

class DashboardSummary {
  const DashboardSummary({
    required this.roles,
    required this.stores,
    required this.lowStockProducts,
    required this.todaySales,
    required this.pendingPurchases,
  });

  final List<String> roles;
  final int stores;
  final int lowStockProducts;
  final double todaySales;
  final int pendingPurchases;

  factory DashboardSummary.fromJson(Map<String, dynamic> json) => DashboardSummary(
        roles: List<String>.from(json['role'] as List),
        stores: (json['stores'] as num).toInt(),
        lowStockProducts: (json['lowStockProducts'] as num).toInt(),
        todaySales: double.parse(json['todaySales'].toString()),
        pendingPurchases: (json['pendingPurchases'] as num).toInt(),
      );
}

class DashboardRepository {
  const DashboardRepository(this._apiClient);
  final ApiClient _apiClient;

  Future<DashboardSummary> loadSummary() async {
    final response = await _apiClient.dio.get<Map<String, dynamic>>('/dashboard/summary');
    return DashboardSummary.fromJson(response.data!);
  }
}
