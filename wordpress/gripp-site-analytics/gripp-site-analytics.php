<?php
/**
 * Plugin Name: Gripp Site Analytics
 * Description: Collecte les performances d'un site WordPress et les envoie vers le dashboard central.
 * Version: 0.1.0
 * Author: Gripp MCP
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Gripp_Site_Analytics_Plugin {
    private const VERSION = '0.1.0';
    private const OPTION_NAME = 'gripp_site_analytics_options';
    private const REST_NAMESPACE = 'gripp-site-analytics/v1';
    private const REST_ROUTE = '/event';
    private const SCRIPT_HANDLE = 'gripp-site-analytics';

    public static function activate(): void {
        $options = get_option(self::OPTION_NAME, []);
        if (!is_array($options)) {
            $options = [];
        }

        if (empty($options['public_key'])) {
            $options['public_key'] = wp_generate_password(32, false, false);
            update_option(self::OPTION_NAME, $options, false);
        }
    }

    public function boot(): void {
        add_action('admin_menu', [$this, 'register_admin_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_tracker']);
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

        add_settings_field('endpoint_url', 'Endpoint dashboard', [$this, 'render_text_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'endpoint_url',
            'placeholder' => 'https://votre-domaine.vercel.app/api/site-analytics/collect',
            'type' => 'url'
        ]);
        add_settings_field('site_id', 'Site ID', [$this, 'render_text_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'site_id',
            'placeholder' => 'client-site',
            'type' => 'text'
        ]);
        add_settings_field('site_token', 'Token site', [$this, 'render_text_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'site_token',
            'placeholder' => 'token genere pour ce site',
            'type' => 'password'
        ]);
        add_settings_field('track_logged_in', 'Utilisateurs connectes', [$this, 'render_checkbox_field'], 'gripp-site-analytics', 'gripp_site_analytics_main', [
            'name' => 'track_logged_in',
            'label' => 'Inclure les utilisateurs connectes'
        ]);
    }

    public function sanitize_options($input): array {
        $existing = $this->options();
        $input = is_array($input) ? $input : [];

        return [
            'endpoint_url' => esc_url_raw($input['endpoint_url'] ?? ''),
            'site_id' => sanitize_key($input['site_id'] ?? ''),
            'site_token' => sanitize_text_field($input['site_token'] ?? ''),
            'track_logged_in' => !empty($input['track_logged_in']) ? '1' : '',
            'public_key' => sanitize_text_field($existing['public_key'] ?? wp_generate_password(32, false, false))
        ];
    }

    public function render_settings_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>Gripp Site Analytics</h1>
            <form action="options.php" method="post">
                <?php
                settings_fields('gripp_site_analytics');
                do_settings_sections('gripp-site-analytics');
                submit_button('Enregistrer');
                ?>
            </form>
        </div>
        <?php
    }

    public function render_text_field(array $args): void {
        $options = $this->options();
        $name = (string) ($args['name'] ?? '');
        $type = (string) ($args['type'] ?? 'text');
        $placeholder = (string) ($args['placeholder'] ?? '');
        $value = (string) ($options[$name] ?? '');
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

    public function register_rest_routes(): void {
        register_rest_route(self::REST_NAMESPACE, self::REST_ROUTE, [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'handle_event'],
            'permission_callback' => '__return_true'
        ]);
    }

    public function enqueue_tracker(): void {
        $options = $this->options();
        if (is_admin() || is_feed() || is_robots()) {
            return;
        }
        if (is_user_logged_in() && empty($options['track_logged_in'])) {
            return;
        }
        if (!$this->is_configured($options)) {
            return;
        }

        wp_enqueue_script(
            self::SCRIPT_HANDLE,
            plugin_dir_url(__FILE__) . 'assets/tracker.js',
            [],
            self::VERSION,
            true
        );
        wp_localize_script(self::SCRIPT_HANDLE, 'grippSiteAnalytics', [
            'restUrl' => esc_url_raw(rest_url(self::REST_NAMESPACE . self::REST_ROUTE)),
            'publicKey' => (string) $options['public_key']
        ]);
    }

    public function handle_event(WP_REST_Request $request) {
        $options = $this->options();
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

    private function options(): array {
        $options = get_option(self::OPTION_NAME, []);
        return is_array($options) ? $options : [];
    }
}

register_activation_hook(__FILE__, ['Gripp_Site_Analytics_Plugin', 'activate']);
(new Gripp_Site_Analytics_Plugin())->boot();
