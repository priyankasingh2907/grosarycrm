import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'core/api/api_client.dart';
import 'features/auth/auth_cubit.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/login_page.dart';
import 'features/dashboard/dashboard_page.dart';

class GroceryCrmApp extends StatelessWidget {
  const GroceryCrmApp({super.key});

  @override
  Widget build(BuildContext context) {
    final apiClient = ApiClient();
    return RepositoryProvider.value(
      value: apiClient,
      child: BlocProvider(
        create: (_) => AuthCubit(AuthRepository(apiClient), apiClient),
        child: MaterialApp(
          title: 'Grocery CRM',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF247A57)),
            scaffoldBackgroundColor: const Color(0xFFF7F9F7),
            appBarTheme: const AppBarTheme(
              backgroundColor: Color(0xFFF7F9F7),
              foregroundColor: Color(0xFF17251E),
              elevation: 0,
              scrolledUnderElevation: 0,
              centerTitle: false,
            ),
            inputDecorationTheme: InputDecorationTheme(
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE3EAE5)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE3EAE5)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFF247A57), width: 1.5),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            ),
            cardColor: Colors.white,
            useMaterial3: true,
          ),
          home: BlocBuilder<AuthCubit, AuthState>(
            builder: (context, state) {
              if (state is Authenticated) return DashboardPage(session: state.session);
              if (state is AuthLoading) return const _LoadingScreen();
              return const LoginPage();
            },
          ),
        ),
      ),
    );
  }
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
}
