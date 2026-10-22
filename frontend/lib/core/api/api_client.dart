import 'package:dio/dio.dart';

class ApiClient {
  ApiClient()
      : dio = Dio(BaseOptions(
          baseUrl: const String.fromEnvironment(
            'API_BASE_URL',
            defaultValue: 'http://localhost:3000/api/v1',
          ),
          connectTimeout: const Duration(seconds: 8),
          receiveTimeout: const Duration(seconds: 12),
          headers: {'content-type': 'application/json'},
        ));

  final Dio dio;

  void setAccessToken(String? token) {
    if (token == null) {
      dio.options.headers.remove('authorization');
    } else {
      dio.options.headers['authorization'] = 'Bearer $token';
    }
  }
}
