<?php
/**
 * Plugin Name: Gripp Site Analytics
 * Description: Collecte les performances d'un site WordPress et les envoie vers le dashboard central.
 * Version: 0.2.4
 * Author: Gripp MCP
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Gripp_Site_Analytics_Plugin {
    private const VERSION = '0.2.4';
    private const OPTION_NAME = 'gripp_site_analytics_options';
    private const REST_NAMESPACE = 'gripp-site-analytics/v1';
    private const REST_ROUTE = '/event';
    private const COLLECT_PATH = '/api/site-analytics/collect';
    private const REGISTER_PATH = '/api/site-analytics/register';
    private const PING_PATH = '/api/site-analytics/ping';
    private const DEFAULT_DASHBOARD_URL = '';
    private const REGISTRATION_TOKEN = '';
    private const SCRIPT_HANDLE = 'gripp-site-analytics';

    public static function activate(): void {
        $options = get_option(self::OPTION_NAME, []);
        if (!is_array($options)) {
            $options = [];
        }

        if (empty($options['public_key'])) {
            $options['public_key'] = wp_generate_password(32, false, false);
        }

        $options = self::apply_default_dashboard_options($options);
        update_option(self::OPTION_NAME, $options, false);
    }

    public function boot(): void {
        add_action('admin_menu', [$this, 'register_admin_page']);
        add_action('init', [$this, 'maybe_auto_register_site'], 20);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_post_gripp_site_analytics_register', [$this, 'handle_manual_register']);
        add_action('admin_post_gripp_site_analytics_ping', [$this, 'handle_dashboard_ping']);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_tracker']);
        add_action('wp_footer', [$this, 'render_tracker_fallback'], 99);
    }

    public function register_admin_page(): void {
        add_options_page(
            'Gripp Site Analytics',
            'Gripp Analytics',
            'manage_options',
            'gripp-site-analytics',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings(): void {
        register_setting('gripp_site_analytics', self::OPTION_NAME, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_options'],
            'default' => []
        ]);

        add_settings_section(
            'gripp_site_analytics_main',
            'Connexion dashboard',
            '__return_false',
            'gripp-site-analytics'
        );

        add_settings_field('dashboard_url', 'URL dashboard', [$this, 'render_text_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'dashboard_url',
            'placeholder' => 'https://votre-domaine.vercel.app',
            'type' => 'url'
        ]);
        add_settings_field('track_logged_in', 'Utilisateurs connectes', [$this, 'render_checkbox_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'track_logged_in',
            'label' => 'Inclure les utilisateurs connectes'
        ]);
    }

    public function sanitize_options($input): array {
        $existing = $this->options();
        $input = is_array($input) ? $input : [];
        $existing_dashboard_url = self::dashboard_url_from_options($existing);
        $has_dashboard_input = array_key_exists('dashboard_url', $input);
        $dashboard_url = self::normalize_dashboard_url((string) ($input['dashboard_url'] ?? $existing_dashboard_url));
        $dashboard_cleared = $has_dashboard_input && $dashboard_url === '';
        $dashboard_changed = $dashboard_url !== '' && $existing_dashboard_url !== '' && $dashboard_url !== $existing_dashboard_url;
        $reset_connection = $dashboard_changed || $dashboard_cleared;
        $site_id = $reset_connection ? '' : sanitize_key($existing['site_id'] ?? '');
        $site_token = $reset_connection ? '' : sanitize_text_field($existing['site_token'] ?? '');

        return [
            'dashboard_url' => $dashboard_url,
            'endpoint_url' => $dashboard_url ? self::build_dashboard_endpoint_url($dashboard_url, self::COLLECT_PATH) : '',
            'site_id' => $site_id,
            'site_token' => $site_token,
            'track_logged_in' => !empty($input['track_logged_in']) ? '1' : '',
            'public_key' => sanitize_text_field($existing['public_key'] ?? wp_generate_password(32, false, false)),
            'registration_attempted_at' => $reset_connection ? 0 : absint($existing['registration_attempted_at'] ?? 0),
            'registration_error' => $reset_connection ? '' : sanitize_text_field($existing['registration_error'] ?? ''),
            'registration_plugin_version' => $reset_connection ? '' : sanitize_text_field($existing['registration_plugin_version'] ?? ''),
            'last_ping_at' => $reset_connection ? 0 : absint($existing['last_ping_at'] ?? 0),
            'ping_error' => $reset_connection ? '' : sanitize_text_field($existing['ping_error'] ?? '')
        ];
    }

    public function render_settings_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>Gripp Site Analytics</h1>
            <?php
            $options = $this->options();
            $this->render_connection_notice($options);
            ?>
            <form action="options.php" method="post">
                <?php
                settings_fields('gripp_site_analytics');
                do_settings_sections('gripp-site-analytics');
                submit_button('Enregistrer');
                ?>
            </form>
            <?php $this->render_manual_register_form($options); ?>
            <?php $this->render_dashboard_ping_form($options); ?>
        </div>
        <?php
    }

    public function render_text_field(array $args): void {
        $options = $this->options();
        $name = (string) ($args['name'] ?? '');
        $type = (string) ($args['type'] ?? 'text');
        $placeholder = (string) ($args['placeholder'] ?? '');
        $value = (string) ($options[$name] ?? '');
        if ($name === 'dashboard_url' && $value === '') {
            $value = self::DEFAULT_DASHBOARD_URL;
        }
        ?>
        <input
            class="regular-text"
            type="<?php echo esc_attr($type); ?>"
            name="<?php echo esc_attr(self::OPTION_NAME . '[' . $name . ']'); ?>"
            value="<?php echo esc_attr($value); ?>"
            placeholder="<?php echo esc_attr($placeholder); ?>"
            autocomplete="off"
        />
        <?php
    }

    public function render_checkbox_field(array $args): void {
        $options = $this->options();
        $name = (string) ($args['name'] ?? '');
        $label = (string) ($args['label'] ?? '');
        ?>
        <label>
            <input
                type="checkbox"
                name="<?php echo esc_attr(self::OPTION_NAME . '[' . $name . ']'); ?>"
                value="1"
                <?php checked(!empty($options[$name])); ?>
            />
            <?php echo esc_html($label); ?>
        </label>
        <?php
    }

    public function render_connection_notice(array $options): void {
        if ($this->is_configured($options)) {
            ?>
            <div class="notice notice-success inline">
                <p>
                    <?php echo esc_html('Connecte au dashboard. Site ID: ' . (string) $options['site_id']); ?>
                </p>
                <?php if (!empty($options['last_ping_at'])) { ?>
                    <p>
                        <?php echo esc_html('Dernier test dashboard OK: ' . date_i18n(get_option('date_format') . ' ' . get_option('time_format'), absint($options['last_ping_at']))); ?>
                    </p>
                <?php } ?>
                <?php if (!empty($options['ping_error'])) { ?>
                    <p>
                        <?php echo esc_html('Dernier test dashboard echoue: ' . (string) $options['ping_error']); ?>
                    </p>
                <?php } ?>
            </div>
            <?php
            return;
        }

        if (!self::dashboard_url_from_options($options)) {
            ?>
            <div class="notice notice-warning inline">
                <p>Ajoutez l'URL du dashboard pour lancer la connexion automatique.</p>
            </div>
            <?php
            return;
        }

        if (!empty($options['registration_error'])) {
            ?>
            <div class="notice notice-error inline">
                <p>
                    <?php echo esc_html('Connexion automatique echouee: ' . (string) $options['registration_error']); ?>
                </p>
            </div>
            <?php
            return;
        }

        if (!empty($options['registration_attempted_at'])) {
            ?>
            <div class="notice notice-warning inline">
                <p>Connexion pas encore finalisee. Cliquez sur Connecter maintenant pour relancer et afficher l'erreur exacte.</p>
            </div>
            <?php
            return;
        }

        ?>
        <div class="notice notice-info inline">
            <p>Connexion prete. Cliquez sur Enregistrer, puis sur Connecter maintenant si le statut ne passe pas en connecte.</p>
        </div>
        <?php
    }

    public function render_manual_register_form(array $options): void {
        if ($this->is_configured($options) || !self::dashboard_url_from_options($options)) {
            return;
        }
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top: 12px;">
            <input type="hidden" name="action" value="gripp_site_analytics_register" />
            <?php wp_nonce_field('gripp_site_analytics_register'); ?>
            <?php submit_button('Connecter maintenant', 'secondary', 'submit', false); ?>
        </form>
        <?php
    }

    public function render_dashboard_ping_form(array $options): void {
        if (!$this->is_configured($options)) {
            return;
        }
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top: 12px;">
            <input type="hidden" name="action" value="gripp_site_analytics_ping" />
            <?php wp_nonce_field('gripp_site_analytics_ping'); ?>
            <?php submit_button('Tester la connexion dashboard', 'secondary', 'submit', false); ?>
        </form>
        <?php
    }

    public function maybe_auto_register_site(): void {
        $this->ensure_dashboard_registration($this->options());
    }

    public function handle_manual_register(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Acces refuse.', 'gripp-site-analytics'));
        }

        check_admin_referer('gripp_site_analytics_register');

        $options = $this->options();
        if (empty($options['public_key'])) {
            $options['public_key'] = wp_generate_password(32, false, false);
        }
        $options = self::apply_default_dashboard_options($options);
        $dashboard_url = self::dashboard_url_from_options($options);
        if ($dashboard_url) {
            $this->register_site_with_dashboard($options, $dashboard_url);
        } else {
            $this->store_registration_error($options, 'URL dashboard manquante');
        }

        wp_safe_redirect(admin_url('options-general.php?page=gripp-site-analytics'));
        exit;
    }

    public function handle_dashboard_ping(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Acces refuse.', 'gripp-site-analytics'));
        }

        check_admin_referer('gripp_site_analytics_ping');

        $options = $this->ensure_dashboard_registration($this->options());
        if ($this->is_configured($options)) {
            $this->ping_dashboard($options);
        } else {
            $this->store_ping_error($options, 'Plugin non connecte.');
        }

        wp_safe_redirect(admin_url('options-general.php?page=gripp-site-analytics'));
        exit;
    }

    private function register_site_with_dashboard(array $options, string $dashboard_url): bool {
        $options['registration_attempted_at'] = time();
        $options['registration_error'] = '';
        $options['registration_plugin_version'] = self::VERSION;
        update_option(self::OPTION_NAME, $options, false);

        $headers = [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json'
        ];
        if (self::REGISTRATION_TOKEN !== '') {
            $headers['X-Site-Analytics-Registration-Token'] = self::REGISTRATION_TOKEN;
        }

        $response = wp_remote_post(self::build_dashboard_endpoint_url($dashboard_url, self::REGISTER_PATH), [
            'timeout' => 10,
            'redirection' => 0,
            'headers' => $headers,
            'body' => wp_json_encode([
                'site_url' => home_url('/'),
                'site_name' => get_bloginfo('name'),
                'installation_id' => (string) ($options['public_key'] ?? ''),
                'plugin_version' => self::VERSION
            ])
        ]);

        if (is_wp_error($response)) {
            $this->store_registration_error($options, $response->get_error_message());
            return false;
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $raw_body = (string) wp_remote_retrieve_body($response);
        $body = json_decode($raw_body, true);
        if ($status < 200 || $status >= 300 || !is_array($body)) {
            $this->store_registration_error($options, $this->format_dashboard_http_error($response, $body, $raw_body));
            return false;
        }

        $site_id = sanitize_key($body['site_id'] ?? '');
        $site_token = sanitize_text_field($body['site_token'] ?? '');
        $collect_url = esc_url_raw($body['collect_url'] ?? self::build_dashboard_endpoint_url($dashboard_url, self::COLLECT_PATH));
        if (!$site_id || !$site_token || !$collect_url) {
            $this->store_registration_error($options, 'reponse dashboard incomplete');
            return false;
        }

        $options['dashboard_url'] = $dashboard_url;
        $options['endpoint_url'] = $collect_url;
        $options['site_id'] = $site_id;
        $options['site_token'] = $site_token;
        $options['registration_error'] = '';
        $options['ping_error'] = '';
        update_option(self::OPTION_NAME, $options, false);

        return true;
    }

    private function ping_dashboard(array $options): bool {
        $dashboard_url = self::dashboard_url_from_options($options);
        $site_id = sanitize_key($options['site_id'] ?? '');
        $site_token = sanitize_text_field($options['site_token'] ?? '');
        if (!$dashboard_url || !$site_id || !$site_token) {
            $this->store_ping_error($options, 'Configuration dashboard incomplete.');
            return false;
        }

        $response = wp_remote_post(self::build_dashboard_endpoint_url($dashboard_url, self::PING_PATH), [
            'timeout' => 8,
            'redirection' => 0,
            'headers' => [
                'Accept' => 'application/json',
                'Authorization' => 'Bearer ' . $site_token,
                'Content-Type' => 'application/json'
            ],
            'body' => wp_json_encode([
                'site_id' => $site_id,
                'site_url' => home_url('/'),
                'plugin_version' => self::VERSION
            ])
        ]);

        if (is_wp_error($response)) {
            $this->store_ping_error($options, $response->get_error_message());
            return false;
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $raw_body = (string) wp_remote_retrieve_body($response);
        $body = json_decode($raw_body, true);
        if ($status < 200 || $status >= 300 || !is_array($body) || empty($body['ok'])) {
            $this->store_ping_error($options, $this->format_dashboard_http_error($response, $body, $raw_body));
            return false;
        }

        $options['last_ping_at'] = time();
        $options['ping_error'] = '';
        update_option(self::OPTION_NAME, $options, false);

        return true;
    }

    private function store_registration_error(array $options, string $message): void {
        $options['registration_error'] = sanitize_text_field($message);
        update_option(self::OPTION_NAME, $options, false);
    }

    private function store_ping_error(array $options, string $message): void {
        $options['ping_error'] = sanitize_text_field($message);
        update_option(self::OPTION_NAME, $options, false);
    }

    private function format_dashboard_http_error($response, $body, string $raw_body): string {
        $status = (int) wp_remote_retrieve_response_code($response);
        $message = (string) wp_remote_retrieve_response_message($response);
        if (is_array($body) && !empty($body['error'])) {
            $message = (string) $body['error'];
        } elseif ($raw_body !== '') {
            $message = substr(wp_strip_all_tags($raw_body), 0, 160);
        }

        return trim('HTTP ' . (string) $status . ' ' . $message);
    }

    public function register_rest_routes(): void {
        register_rest_route(self::REST_NAMESPACE, self::REST_ROUTE, [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'handle_event'],
            'permission_callback' => '__return_true'
        ]);
    }

    public function enqueue_tracker(): void {
        $options = $this->ensure_dashboard_registration($this->options());
        if (!$this->should_track_current_request($options)) {
            return;
        }

        wp_enqueue_script(
            self::SCRIPT_HANDLE,
            plugin_dir_url(__FILE__) . 'assets/tracker.js',
            [],
            self::VERSION,
            true
        );
        wp_add_inline_script(self::SCRIPT_HANDLE, $this->tracker_config_script($options), 'before');
    }

    public function render_tracker_fallback(): void {
        $options = $this->ensure_dashboard_registration($this->options());
        if (!$this->should_track_current_request($options)) {
            return;
        }

        $script_src = plugin_dir_url(__FILE__) . 'assets/tracker.js?ver=' . rawurlencode(self::VERSION);
        ?>
        <script id="gripp-site-analytics-fallback">
        <?php echo $this->tracker_config_script($options); ?>
        if (!window.__grippSiteAnalyticsLoaded) {
          var grippSiteAnalyticsScript = document.createElement('script');
          grippSiteAnalyticsScript.src = <?php echo wp_json_encode($script_src); ?>;
          grippSiteAnalyticsScript.async = true;
          grippSiteAnalyticsScript.setAttribute('data-gripp-site-analytics', 'fallback');
          document.head.appendChild(grippSiteAnalyticsScript);
        }
        </script>
        <?php
    }

    public function handle_event(WP_REST_Request $request) {
        $options = $this->ensure_dashboard_registration($this->options());
        if (!$this->is_configured($options)) {
            return new WP_Error('gripp_site_analytics_not_configured', 'Plugin analytics non configure.', ['status' => 503]);
        }

        $payload = $request->get_json_params();
        if (!is_array($payload) || !hash_equals((string) $options['public_key'], (string) ($payload['public_key'] ?? ''))) {
            return new WP_Error('gripp_site_analytics_forbidden', 'Evenement refuse.', ['status' => 403]);
        }

        $event = $this->sanitize_event($payload, $options);
        if (!$event) {
            return new WP_Error('gripp_site_analytics_invalid_event', 'Evenement invalide.', ['status' => 400]);
        }

        $response = wp_remote_post((string) $options['endpoint_url'], [
            'timeout' => 6,
            'redirection' => 0,
            'headers' => [
                'Authorization' => 'Bearer ' . (string) $options['site_token'],
                'Content-Type' => 'application/json'
            ],
            'body' => wp_json_encode($event)
        ]);

        if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) >= 400) {
            return new WP_Error('gripp_site_analytics_forward_failed', 'Transmission analytics echouee.', ['status' => 502]);
        }

        return new WP_REST_Response(['ok' => true], 202);
    }

    private function sanitize_event(array $payload, array $options): ?array {
        $event_type = sanitize_key($payload['event_type'] ?? '');
        if (!in_array($event_type, ['page_view', 'engagement', 'scroll'], true)) {
            return null;
        }

        $visitor_id = sanitize_text_field($payload['visitor_id'] ?? '');
        $session_id = sanitize_text_field($payload['session_id'] ?? '');
        $page_view_id = sanitize_text_field($payload['page_view_id'] ?? '');
        if (!$visitor_id || !$session_id || !$page_view_id) {
            return null;
        }

        return [
            'site_id' => (string) $options['site_id'],
            'site_url' => home_url('/'),
            'event_type' => $event_type,
            'visitor_id' => $visitor_id,
            'session_id' => $session_id,
            'page_view_id' => $page_view_id,
            'page_url' => esc_url_raw($payload['page_url'] ?? ''),
            'path' => sanitize_text_field($payload['path'] ?? ''),
            'page_title' => sanitize_text_field($payload['page_title'] ?? ''),
            'referrer' => esc_url_raw($payload['referrer'] ?? ''),
            'source' => sanitize_text_field($payload['source'] ?? ''),
            'medium' => sanitize_text_field($payload['medium'] ?? ''),
            'campaign' => sanitize_text_field($payload['campaign'] ?? ''),
            'active_time_ms_delta' => min(3600000, absint($payload['active_time_ms_delta'] ?? 0)),
            'scroll_percent' => min(100, max(0, (float) ($payload['scroll_percent'] ?? 0))),
            'viewport_width' => absint($payload['viewport_width'] ?? 0),
            'viewport_height' => absint($payload['viewport_height'] ?? 0)
        ];
    }

    private function is_configured(array $options): bool {
        return !empty($options['endpoint_url']) && !empty($options['site_id']) && !empty($options['site_token']) && !empty($options['public_key']);
    }

    private function ensure_dashboard_registration(array $options): array {
        if (empty($options['public_key'])) {
            $options['public_key'] = wp_generate_password(32, false, false);
            update_option(self::OPTION_NAME, $options, false);
        }

        $options_with_defaults = self::apply_default_dashboard_options($options);
        if ($options_with_defaults !== $options) {
            $options = $options_with_defaults;
            update_option(self::OPTION_NAME, $options, false);
        }

        if ($this->is_configured($options)) {
            return $options;
        }

        $dashboard_url = self::dashboard_url_from_options($options);
        if (!$dashboard_url || !$this->can_attempt_registration($options)) {
            return $options;
        }

        $this->register_site_with_dashboard($options, $dashboard_url);

        return $this->options();
    }

    private function can_attempt_registration(array $options): bool {
        if ((string) ($options['registration_plugin_version'] ?? '') !== self::VERSION) {
            return true;
        }

        $last_attempt = absint($options['registration_attempted_at'] ?? 0);
        if ($last_attempt > 0 && time() - $last_attempt < 300) {
            return false;
        }

        return true;
    }

    private function should_track_current_request(array $options): bool {
        if (is_admin() || is_feed() || is_robots()) {
            return false;
        }
        if (is_user_logged_in() && empty($options['track_logged_in'])) {
            return false;
        }

        return $this->is_configured($options);
    }

    private function tracker_config(array $options): array {
        return [
            'restUrl' => esc_url_raw(rest_url(self::REST_NAMESPACE . self::REST_ROUTE)),
            'publicKey' => (string) $options['public_key']
        ];
    }

    private function tracker_config_script(array $options): string {
        $config = wp_json_encode($this->tracker_config($options));
        if (!is_string($config)) {
            $config = '{}';
        }

        return 'window.grippSiteAnalytics = ' . $config . ';';
    }

    private static function apply_default_dashboard_options(array $options): array {
        $dashboard_url = self::dashboard_url_from_options($options);
        if (!$dashboard_url && self::DEFAULT_DASHBOARD_URL !== '') {
            $dashboard_url = self::normalize_dashboard_url(self::DEFAULT_DASHBOARD_URL);
            if ($dashboard_url) {
                $options['dashboard_url'] = $dashboard_url;
            }
        }

        if ($dashboard_url) {
            $options['dashboard_url'] = $dashboard_url;
            if (empty($options['endpoint_url'])) {
                $options['endpoint_url'] = self::build_dashboard_endpoint_url($dashboard_url, self::COLLECT_PATH);
            }
        }

        return $options;
    }

    private static function dashboard_url_from_options(array $options): string {
        $dashboard_url = self::normalize_dashboard_url((string) ($options['dashboard_url'] ?? ''));
        if ($dashboard_url) {
            return $dashboard_url;
        }

        return self::dashboard_url_from_endpoint((string) ($options['endpoint_url'] ?? ''));
    }

    private static function dashboard_url_from_endpoint(string $endpoint_url): string {
        $endpoint_url = esc_url_raw($endpoint_url);
        if (!$endpoint_url) {
            return '';
        }

        $parts = parse_url($endpoint_url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return '';
        }

        $path = (string) ($parts['path'] ?? '');
        if (substr($path, -strlen(self::COLLECT_PATH)) !== self::COLLECT_PATH) {
            return self::normalize_dashboard_url($endpoint_url);
        }

        $base_path = substr($path, 0, -strlen(self::COLLECT_PATH));
        $origin = strtolower((string) $parts['scheme']) . '://' . (string) $parts['host'];
        if (!empty($parts['port'])) {
            $origin .= ':' . (string) $parts['port'];
        }

        return self::normalize_dashboard_url($origin . $base_path);
    }

    private static function normalize_dashboard_url(string $dashboard_url): string {
        $dashboard_url = esc_url_raw(trim($dashboard_url));
        if (!$dashboard_url) {
            return '';
        }

        $parts = parse_url($dashboard_url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return '';
        }

        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return '';
        }

        $url = $scheme . '://' . (string) $parts['host'];
        if (!empty($parts['port'])) {
            $url .= ':' . (string) $parts['port'];
        }
        if (!empty($parts['path']) && $parts['path'] !== '/') {
            $url .= '/' . trim((string) $parts['path'], '/');
        }

        return rtrim($url, '/');
    }

    private static function build_dashboard_endpoint_url(string $dashboard_url, string $path): string {
        return rtrim($dashboard_url, '/') . $path;
    }

    private function options(): array {
        $options = get_option(self::OPTION_NAME, []);
        return is_array($options) ? $options : [];
    }
}

register_activation_hook(__FILE__, ['Gripp_Site_Analytics_Plugin', 'activate']);
(new Gripp_Site_Analytics_Plugin())->boot();
