package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type EmailJSClient struct {
	ServiceID  string
	TemplateID string
	PublicKey  string
	PrivateKey string
	httpClient *http.Client
}

var emailJSClient *EmailJSClient

func initEmailJS() {
	emailJSClient = &EmailJSClient{
		ServiceID:  strings.TrimSpace(os.Getenv("EMAILJS_SERVICE_ID")),
		TemplateID: strings.TrimSpace(os.Getenv("EMAILJS_TEMPLATE_ID")),
		PublicKey:  strings.TrimSpace(os.Getenv("EMAILJS_PUBLIC_KEY")),
		PrivateKey: strings.TrimSpace(os.Getenv("EMAILJS_PRIVATE_KEY")),
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *EmailJSClient) Enabled() bool {
	return c != nil &&
		c.ServiceID != "" &&
		c.TemplateID != "" &&
		c.PublicKey != ""
}

func (c *EmailJSClient) SendOTP(email, code string) error {
	if !c.Enabled() {
		// DEV MODE: просто логируем код
		fmt.Printf("\n========================================\n")
		fmt.Printf("🔐 [DEV] OTP CODE: %s\n", code)
		fmt.Printf("📧 Email: %s\n", email)
		fmt.Printf("⚠️  EmailJS не настроен — используй код выше\n")
		fmt.Printf("========================================\n\n")
		return nil
	}

	body := map[string]interface{}{
		"service_id":  c.ServiceID,
		"template_id": c.TemplateID,
		"user_id":     c.PublicKey,
		"accessToken": c.PrivateKey,
		"template_params": map[string]interface{}{
			"to_email": email,
			"email":    email,
			"otp_code": code,
			"code":     code,
			"passcode": code,
		},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal emailjs payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://api.emailjs.com/api/v1.0/email/send",
		bytes.NewReader(payload),
	)
	if err != nil {
		return fmt.Errorf("create emailjs request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("emailjs request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	respText := strings.TrimSpace(string(respBody))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("emailjs status=%d body=%s", resp.StatusCode, respText)
	}

	return nil
}
