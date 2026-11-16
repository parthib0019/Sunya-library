/* ==========================================================================
   LibSunya Frontend Enhancements & Drawer Controller
   ========================================================================== */

(function($) {
  'use strict';

  function initDrawer() {
    var $toggle = $('#libsunya-drawer-toggle');
    var $drawer = $('#libsunya-drawer');
    var $backdrop = $('#libsunya-drawer-backdrop');
    var $close = $('#libsunya-drawer-close');

    function openDrawer() {
      $drawer.addClass('active');
      $backdrop.addClass('active');
      $('body').addClass('libsunya-drawer-open');
    }

    function closeDrawer() {
      $drawer.removeClass('active');
      $backdrop.removeClass('active');
      $('body').removeClass('libsunya-drawer-open');
    }

    $toggle.on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if ($drawer.hasClass('active')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });

    $close.on('click', function(e) {
      e.preventDefault();
      closeDrawer();
    });

    $backdrop.on('click', function() {
      closeDrawer();
    });

    $(document).on('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if ($drawer.hasClass('active')) {
          closeDrawer();
        }
      }
    });
  }

  // YouTube-style Profile Avatar Dropdown Controller
  function initProfileDropdown() {
    var $container = $('#libsunya-profile-dropdown');
    var $btn = $('#libsunyaAvatarMenu');

    if (!$container.length || !$btn.length) {
      return;
    }

    $btn.on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var willOpen = !$container.hasClass('open');
      $('.dropdown.open').not($container).removeClass('open');
      $container.toggleClass('open', willOpen);
      $btn.attr('aria-expanded', willOpen ? 'true' : 'false');
    });

    // Close when tapping or clicking outside
    $(document).on('click touchstart', function(e) {
      if (!$(e.target).closest('#libsunya-profile-dropdown').length) {
        if ($container.hasClass('open')) {
          $container.removeClass('open');
          $btn.attr('aria-expanded', 'false');
        }
      }
    });

    // Close on Escape key
    $(document).on('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if ($container.hasClass('open')) {
          $container.removeClass('open');
          $btn.attr('aria-expanded', 'false');
        }
      }
    });

    // Close menu when clicking on any action link inside
    $container.find('.libsunya-dropdown-link').on('click', function() {
      $container.removeClass('open');
      $btn.attr('aria-expanded', 'false');
    });
  }

  // Dark / Light Mode Switch Controller
  function initThemeToggle() {
    var $checkbox = $('#libsunyaThemeToggleCheckbox');
    var $row = $('#libsunya-theme-toggle-btn');
    var $text = $('#libsunya-theme-text');
    var $icon = $('#libsunya-theme-icon');

    if (!$checkbox.length) return;

    function applyTheme(theme) {
      if (theme === 'light') {
        $('html').attr('data-theme', 'light');
        $checkbox.prop('checked', false);
        $text.text('Light Mode');
        $icon.removeClass('glyphicon-adjust').addClass('glyphicon-asterisk text-orange');
        try { localStorage.setItem('libsunya-theme', 'light'); } catch(e) {}
      } else {
        $('html').attr('data-theme', 'dark');
        $checkbox.prop('checked', true);
        $text.text('Dark Mode');
        $icon.removeClass('glyphicon-asterisk').addClass('glyphicon-adjust text-orange');
        try { localStorage.setItem('libsunya-theme', 'dark'); } catch(e) {}
      }
    }

    var currentTheme = $('html').attr('data-theme') || 'dark';
    try {
      var saved = localStorage.getItem('libsunya-theme');
      if (saved) currentTheme = saved;
    } catch(e) {}
    applyTheme(currentTheme);

    $checkbox.on('change', function(e) {
      e.stopPropagation();
      applyTheme($(this).is(':checked') ? 'dark' : 'light');
    });

    $row.on('click', function(e) {
      e.stopPropagation();
      if (e.target.tagName.toLowerCase() !== 'input' && e.target.tagName.toLowerCase() !== 'label') {
        var isDark = $checkbox.is(':checked');
        $checkbox.prop('checked', !isDark).trigger('change');
      }
    });
  }

  // Strict 10px Grid Layout & Image Load Controller
  function initBookGridLayout() {
    var $grid = $('.discover .row.display-flex, .libsunya-pinterest-grid');
    if (!$grid.length) return;

    function refreshLayout() {
      if (typeof $.fn.isotope !== 'undefined' && $grid.data('isotope')) {
        $grid.isotope('layout');
      }
    }

    // Refresh layout when covers finish loading
    $grid.find('.book img').on('load', function() {
      refreshLayout();
    });

    // Re-layout smoothly on window resize/orientation change
    var resizeTimer;
    $(window).on('resize orientationchange', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refreshLayout, 60);
    });

    // Initial layout pass
    setTimeout(refreshLayout, 50);
  }

  // Enhance floating card interaction
  function initFloatingCards() {
    // Ensure smooth load for lazy images
    $('.book img').on('load', function() {
      $(this).closest('.book').addClass('cover-loaded');
    });
  }

  $(document).ready(function() {
    initDrawer();
    initProfileDropdown();
    initThemeToggle();
    initBookGridLayout();
    initFloatingCards();
  });

})(jQuery);
